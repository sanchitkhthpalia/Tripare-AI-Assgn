import { vi } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, Runtime, DefaultLogger } from "@temporalio/worker";
import * as activities from "../../temporal/src/activities/fetchSupplier";
import request from "supertest";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Mock Temporal Client ─────────────────────────────────────────
// We must mock the client so the Express API sends its workflow
// starts to our time-skipping test environment instead of a real server.

let testEnv: TestWorkflowEnvironment;

vi.mock("@temporalio/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@temporalio/client")>();
  return {
    ...actual,
    Connection: {
      connect: vi.fn(),
    },
    Client: vi.fn().mockImplementation(() => {
      if (!testEnv)
        throw new Error("Client requested before testEnv initialized");
      return testEnv.client;
    }),
  };
});

// Import the app AFTER the mock so any initialization uses the mock.
import { app, server } from "../../apps/backend/src/server";

const workflowsPath = path.resolve(
  __dirname,
  "../../temporal/src/workflows/hotelSearch.ts",
);

let worker: Worker;

let workerRunPromise: Promise<void>;

beforeAll(async () => {
  console.log("beforeAll: starting");
  Runtime.install({ logger: new DefaultLogger("WARN") });
  console.log("beforeAll: creating test environment");
  testEnv = await TestWorkflowEnvironment.createLocal();
  console.log("beforeAll: test environment created");

  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: "hotel-search", // The API uses 'hotel-search' by default
    workflowsPath,
    activities, // Real activities!
  });
  console.log("beforeAll: worker created");

  // Start the worker in the background
  workerRunPromise = worker.run();
  workerRunPromise.catch(console.error);
  console.log("beforeAll: worker started");
}, 60_000);

afterAll(async () => {
  // Shutdown sequence
  server.close();
  if (worker) {
    worker.shutdown();
    await workerRunPromise;
  }
  if (testEnv) await testEnv.teardown();
});

// ── Tests ─────────────────────────────────────────────────────────

describe("Search API Integration", () => {
  const BASE_PAYLOAD = {
    city: "Mumbai",
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
  };

  it("handles a normal search end-to-end", async () => {
    const res = await request(app)
      .post("/api/search-hotels")
      .send({
        ...BASE_PAYLOAD,
        scenarios: { supplierA: "normal", supplierB: "normal" },
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.searchId).toBeDefined();

    // One of them is cheaper (Supplier A is 12000, B is 15000 in Mumbai)
    expect(res.body.result).toBeDefined();
    expect(res.body.result.cheapest.supplier).toBe("SupplierA");
    expect(res.body.result.cheapest.price).toBe(6500);

    // Suppliers map should be populated
    expect(res.body.suppliers.supplierA.status).toBe("ok");
    expect(res.body.suppliers.supplierB.status).toBe("ok");

    // Reason string should be correctly localized and present
    expect(res.body.result.reason).toContain("Supplier A was selected");
    expect(res.body.result.reason).toContain("₹6,500");
  });

  it("handles one supplier failing", async () => {
    const res = await request(app)
      .post("/api/search-hotels")
      .send({
        ...BASE_PAYLOAD,
        scenarios: { supplierA: "error", supplierB: "normal" },
      });

    expect(res.status).toBe(200); // 200 because one succeeded
    expect(res.body.status).toBe("partial"); // One failed

    // A failed, B succeeded
    expect(res.body.result.cheapest.supplier).toBe("SupplierB");
    expect(res.body.result.cheapest.price).toBe(6500);
    expect(res.body.suppliers.supplierA.status).toBe("error");
    expect(res.body.suppliers.supplierB.status).toBe("ok");

    expect(res.body.result.reason).toContain(
      "Supplier B was selected because SupplierA failed to respond",
    );
  });

  it("handles both suppliers failing", async () => {
    const res = await request(app)
      .post("/api/search-hotels")
      .send({
        ...BASE_PAYLOAD,
        scenarios: { supplierA: "error", supplierB: "error" },
      });

    expect(res.status).toBe(502); // 502 Bad Gateway for total upstream failure
    expect(res.body.status).toBe("error");
    expect(res.body.error.code).toBe("ALL_SUPPLIERS_FAILED");
  });

  it("handles empty results from both suppliers", async () => {
    const res = await request(app)
      .post("/api/search-hotels")
      .send({
        ...BASE_PAYLOAD,
        scenarios: { supplierA: "empty", supplierB: "empty" },
      });

    expect(res.status).toBe(200); // Empty is a valid result, not an error
    expect(res.body.status).toBe("no_results");
    expect(res.body.result).toBeUndefined();
    expect(res.body.suppliers.supplierA.status).toBe("empty");
    expect(res.body.suppliers.supplierB.status).toBe("empty");
    expect(res.body.reason).toBe("No hotels were found for this search.");
  });

  it("abandons a slow supplier at the 5s budget and returns the other", async () => {
    const startedAt = Date.now();

    const res = await request(app)
      .post("/api/search-hotels")
      .send({
        ...BASE_PAYLOAD,
        scenarios: { supplierA: "slow", supplierB: "normal" },
      });

    const wallMs = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial"); // A timed out
    expect(res.body.result.cheapest.supplier).toBe("SupplierB");
    expect(res.body.suppliers.supplierB.status).toBe("ok");

    // Must be a timeout, not a generic error.
    expect(res.body.suppliers.supplierA.status).toBe("timeout");

    // The timeout is non-retryable, so A costs exactly one attempt.
    expect(res.body.suppliers.supplierA.attempts).toBe(1);

    // Must finish near the 5s budget, not after three retried attempts.
    expect(wallMs).toBeLessThan(9_000);
  }, 25_000);

  it("handles retries successfully", async () => {
    const res = await request(app)
      .post("/api/search-hotels")
      .send({
        ...BASE_PAYLOAD,
        scenarios: { supplierA: "retry", supplierB: "normal" },
      });

    expect(res.status).toBe(200);
    expect(res.body.suppliers.supplierA.status).toBe("ok");
    // Retries happen transparently, but we can verify it took >1 attempt
    expect(res.body.suppliers.supplierA.attempts).toBeGreaterThan(1);
  });

  it("handles workflow cancellation", async () => {
    // Must be a UUID — the API validates it.
    const searchId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

    // Start a search where both suppliers are slow
    // We don't await this immediately, we fire it off
    const searchPromise = request(app)
      .post("/api/search-hotels")
      .send({
        searchId,
        ...BASE_PAYLOAD,
        scenarios: { supplierA: "slow", supplierB: "slow" },
      })
      .then((res) => res); // Trigger the lazy request

    // Wait for the workflow to actually start before cancelling
    // 1.5 seconds should be enough for the local temporal server
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Cancel it
    const cancelRes = await request(app)
      .post(`/api/search-hotels/${searchId}/cancel`)
      .send();

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.outcome).toBe("cancelled");

    // The search response should eventually resolve to a cancellation response
    const searchRes = await searchPromise;

    expect(searchRes.status).toBe(200); // We map cancellation to 200 OK with 'cancelled' status
    expect(searchRes.body.status).toBe("cancelled");
  });

  it("returns 400 for invalid validation input", async () => {
    const res = await request(app).post("/api/search-hotels").send({
      // Missing city
      checkIn: "2026-10-10",
      checkOut: "2026-10-09", // Check-out before check-in!
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("error");
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toContain("city");
    // The check-out error is only added if checkOut/checkIn strings are valid, since city is required, the city error will always be present.
  });
});
