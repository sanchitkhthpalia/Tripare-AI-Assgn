/**
 * Hotel Search Workflow Tests
 *
 * Uses Temporal's TestWorkflowEnvironment. Activities are mocked, so no
 * network calls. Time-skipping advances workflow timers, but not the clock
 * inside a mocked activity — the two timeout tests do take real seconds.
 *
 * Requires: @temporalio/testing native binaries (auto-downloaded on first run)
 * Does NOT require: a running Temporal server
 */

import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, Runtime, DefaultLogger } from "@temporalio/worker";
import { WorkflowFailedError } from "@temporalio/client";
import { ApplicationFailure, CancelledFailure } from "@temporalio/common";
import { Context } from "@temporalio/activity";
import type {
  HotelSearchRequest,
  WorkflowResult,
  FetchSupplierInput,
  ActivityResult,
} from "@hotel-rate-comparator/shared";
import { hotelSearchWorkflow } from "../../temporal/src/workflows/hotelSearch";

// ── Test environment setup ───────────────────────────────────────

const workflowsPath = path.resolve(
  __dirname,
  "../../temporal/src/workflows/hotelSearch.ts",
);

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  // Suppress noisy Temporal SDK logs during tests
  Runtime.install({ logger: new DefaultLogger("WARN") });
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

// ── Fixtures ─────────────────────────────────────────────────────

const BASE_REQUEST: HotelSearchRequest = {
  searchId: "test-search",
  city: "Goa",
  checkIn: "2026-10-10",
  checkOut: "2026-10-13",
};

type MockFn = (input: FetchSupplierInput) => Promise<ActivityResult>;

function successResult(
  supplier: "SupplierA" | "SupplierB",
  price: number,
  attempts = 1,
): ActivityResult {
  return {
    supplier,
    hotels: [{ hotelId: `${supplier}-h1`, name: `${supplier} Hotel`, price }],
    attempts,
    durationMs: 200,
  };
}

function emptyResult(supplier: "SupplierA" | "SupplierB"): ActivityResult {
  return { supplier, hotels: [], attempts: 1, durationMs: 200 };
}

function createActivities(supplierA: MockFn, supplierB: MockFn) {
  return {
    fetchSupplierHotels: async (
      input: FetchSupplierInput,
    ): Promise<ActivityResult> => {
      if (input.supplier === "SupplierA") return supplierA(input);
      return supplierB(input);
    },
  };
}

/**
 * An activity that hangs until Temporal cancels it.
 * Used to test workflow cancellation propagation.
 */
async function hangingActivity(): Promise<ActivityResult> {
  const ctx = Context.current();
  return new Promise<ActivityResult>((_resolve, reject) => {
    ctx.cancellationSignal.addEventListener("abort", () =>
      reject(new CancelledFailure("Activity cancelled")),
    );
  });
}

/** Sleeps past the activity timeout so the timeout path is exercised. */
async function slowActivity(
  supplier: "SupplierA" | "SupplierB",
): Promise<ActivityResult> {
  await new Promise((resolve) => setTimeout(resolve, 10_000)); // 10s > 5s timeout
  return successResult(supplier, 100);
}

// ── Test runner ──────────────────────────────────────────────────

let counter = 0;

async function runWorkflow(
  activities: ReturnType<typeof createActivities>,
  request: HotelSearchRequest = BASE_REQUEST,
): Promise<WorkflowResult> {
  const taskQueue = `test-queue-${++counter}`;

  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue,
    workflowsPath,
    activities,
  });

  return worker.runUntil(async () => {
    const handle = await testEnv.client.workflow.start(hotelSearchWorkflow, {
      taskQueue,
      workflowId: `test-workflow-${counter}`,
      args: [request],
    });
    return handle.result();
  });
}

// ── Tests ─────────────────────────────────────────────────────────

describe("Hotel Search Workflow", () => {
  // ─────────────────────────────────────────────────────────────
  // Basic comparison scenarios (all from the assignment)
  // ─────────────────────────────────────────────────────────────

  describe("rate comparison", () => {
    it("returns Supplier A when A has the lower rate", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => successResult("SupplierA", 3_500),
          async () => successResult("SupplierB", 3_800),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.cheapest?.price).toBe(3_500);
      expect(result.suppliers.supplierA.status).toBe("ok");
      expect(result.suppliers.supplierB.status).toBe("ok");
      expect(result.reason).toContain("lowest rate");
    });

    it("returns Supplier B when B has the lower rate", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => successResult("SupplierA", 6_800),
          async () => successResult("SupplierB", 5_900),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.cheapest?.price).toBe(5_900);
      expect(result.reason).toContain("lowest rate");
    });

    it("picks Supplier A deterministically when prices are equal", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => successResult("SupplierA", 6_500),
          async () => successResult("SupplierB", 6_500),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.cheapest?.price).toBe(6_500);
      expect(result.reason).toContain("same rate");
      expect(result.reason).toContain("by default");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Partial failure — one supplier fails, other succeeds
  // ─────────────────────────────────────────────────────────────

  describe("partial supplier failure", () => {
    it("returns B when A fails, with supplierA status=error", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => {
            throw new Error("Supplier A connection refused");
          },
          async () => successResult("SupplierB", 3_800),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.cheapest?.price).toBe(3_800);
      expect(result.suppliers.supplierA.status).toBe("error");
      expect(result.suppliers.supplierB.status).toBe("ok");
    });

    it("returns A when B fails, with supplierB status=error", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => successResult("SupplierA", 3_500),
          async () => {
            throw new Error("Supplier B connection refused");
          },
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.suppliers.supplierA.status).toBe("ok");
      expect(result.suppliers.supplierB.status).toBe("error");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Empty responses (supplier responded but had no hotels)
  // ─────────────────────────────────────────────────────────────

  describe("empty supplier responses", () => {
    it("returns A when B returns an empty hotel array", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => successResult("SupplierA", 3_500),
          async () => emptyResult("SupplierB"),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.suppliers.supplierB.status).toBe("empty");
    });

    it("returns B when A returns an empty hotel array", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => emptyResult("SupplierA"),
          async () => successResult("SupplierB", 3_800),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.suppliers.supplierA.status).toBe("empty");
    });

    it("returns cheapest:null when both return empty arrays", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => emptyResult("SupplierA"),
          async () => emptyResult("SupplierB"),
        ),
      );

      expect(result.cheapest).toBeNull();
      expect(result.reason).toContain("No hotels");
      // Both responded — this is "no results", NOT "all failed"
      expect(result.reason).not.toContain("failed");
      expect(result.suppliers.supplierA.status).toBe("empty");
      expect(result.suppliers.supplierB.status).toBe("empty");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Total failure — both suppliers fail
  // ─────────────────────────────────────────────────────────────

  describe("total supplier failure", () => {
    it("throws WorkflowFailedError with type ALL_SUPPLIERS_FAILED when both error", async () => {
      const taskQueue = `test-queue-${++counter}`;

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath,
        activities: createActivities(
          async () => {
            throw new Error("A HTTP 500");
          },
          async () => {
            throw new Error("B HTTP 500");
          },
        ),
      });

      await worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(
          hotelSearchWorkflow,
          {
            taskQueue,
            workflowId: `test-workflow-${counter}`,
            args: [BASE_REQUEST],
          },
        );

        await expect(handle.result()).rejects.toThrow(WorkflowFailedError);

        try {
          await handle.result();
        } catch (err) {
          expect(err).toBeInstanceOf(WorkflowFailedError);
          const wfe = err as WorkflowFailedError;
          expect(wfe.cause).toBeInstanceOf(ApplicationFailure);
          const af = wfe.cause as ApplicationFailure;
          expect(af.type).toBe("ALL_SUPPLIERS_FAILED");
          expect(af.nonRetryable).toBe(true);
        }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Timeout — activity exceeds 5s startToCloseTimeout
  // Time-skipping makes this run instantly.
  // ─────────────────────────────────────────────────────────────

  describe("supplier timeout", () => {
    it("uses the other supplier when one exceeds the 5s activity timeout", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => successResult("SupplierA", 3_500),
          // B hangs for 10s — the 5s activity timeout fires via time-skip
          async () => slowActivity("SupplierB"),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierA");
      // Specifically a timeout, not a generic error.
      expect(result.suppliers.supplierB.status).toBe("timeout");
    }, 30_000);

    it("marks both as failed when both exceed the timeout", async () => {
      const taskQueue = `test-queue-${++counter}`;

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath,
        activities: createActivities(
          async () => slowActivity("SupplierA"),
          async () => slowActivity("SupplierB"),
        ),
      });

      await worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(
          hotelSearchWorkflow,
          {
            taskQueue,
            workflowId: `test-workflow-${counter}`,
            args: [BASE_REQUEST],
          },
        );

        await expect(handle.result()).rejects.toThrow(WorkflowFailedError);
        try {
          await handle.result();
        } catch (err) {
          const wfe = err as WorkflowFailedError;
          expect(wfe.cause).toBeInstanceOf(ApplicationFailure);
          expect((wfe.cause as ApplicationFailure).type).toBe(
            "ALL_SUPPLIERS_FAILED",
          );
        }
      });
    }, 30_000);
  });

  // ─────────────────────────────────────────────────────────────
  // Retry — activity fails then succeeds
  // Verifies Temporal retry policy is configured, not mocked away.
  // ─────────────────────────────────────────────────────────────

  describe("retry behavior", () => {
    it("succeeds when A fails twice then succeeds on attempt 3", async () => {
      let aAttempts = 0;

      const result = await runWorkflow(
        createActivities(
          async () => {
            aAttempts++;
            if (aAttempts < 3) throw new Error(`A attempt ${aAttempts} failed`);
            return successResult("SupplierA", 3_500, aAttempts);
          },
          async () => successResult("SupplierB", 3_800),
        ),
      );

      expect(aAttempts).toBe(3);
      // A succeeded after retries — still in the comparison
      expect(result.suppliers.supplierA.status).toBe("ok");
      expect(result.cheapest?.supplier).toBe("SupplierA");
    });

    it("exhausts retries (3 attempts) and falls back to B", async () => {
      let aAttempts = 0;

      const result = await runWorkflow(
        createActivities(
          async () => {
            aAttempts++;
            throw new Error(`A attempt ${aAttempts} failed`);
          },
          async () => successResult("SupplierB", 3_800),
        ),
      );

      // All 3 retry attempts were exhausted
      expect(aAttempts).toBe(3);
      expect(result.suppliers.supplierA.status).toBe("error");
      expect(result.cheapest?.supplier).toBe("SupplierB");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Cancellation
  // ─────────────────────────────────────────────────────────────

  describe("cancellation", () => {
    it("completes as CANCELLED when workflow is cancelled mid-flight", async () => {
      const taskQueue = `test-queue-${++counter}`;

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath,
        activities: createActivities(hangingActivity, hangingActivity),
      });

      await worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(
          hotelSearchWorkflow,
          {
            taskQueue,
            workflowId: `test-workflow-${counter}`,
            args: [BASE_REQUEST],
          },
        );

        await handle.cancel();

        const err = await handle.result().catch((e) => e);
        expect(err).toBeInstanceOf(WorkflowFailedError);
        expect((err as WorkflowFailedError).cause).toBeInstanceOf(
          CancelledFailure,
        );
      });
    });

    it("cancel on an already-completed workflow is a safe no-op", async () => {
      const taskQueue = `test-queue-${++counter}`;
      const workflowId = `test-workflow-${counter}`;

      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath,
        activities: createActivities(
          async () => successResult("SupplierA", 3_500),
          async () => successResult("SupplierB", 3_800),
        ),
      });

      await worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(
          hotelSearchWorkflow,
          {
            taskQueue,
            workflowId,
            args: [BASE_REQUEST],
          },
        );

        // Wait for completion
        await handle.result();

        // Cancel after completion — must not throw
        await expect(handle.cancel()).resolves.not.toThrow();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Result shape invariants
  // ─────────────────────────────────────────────────────────────

  describe("result shape", () => {
    it("always returns both supplier outcomes regardless of their status", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => {
            throw new Error("A failed");
          },
          async () => successResult("SupplierB", 3_800),
        ),
      );

      expect(result.suppliers.supplierA).toBeDefined();
      expect(result.suppliers.supplierB).toBeDefined();
      expect(result.suppliers.supplierA.supplier).toBe("SupplierA");
      expect(result.suppliers.supplierB.supplier).toBe("SupplierB");
    });

    it("winner hotel has the correct supplier field set", async () => {
      const result = await runWorkflow(
        createActivities(
          async () => successResult("SupplierA", 3_500),
          async () => successResult("SupplierB", 3_800),
        ),
      );

      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.cheapest?.hotelId).toBeDefined();
      expect(result.cheapest?.name).toBeDefined();
      expect(result.cheapest?.price).toBeGreaterThan(0);
    });

    it("picks cheapest hotel within a multi-hotel supplier response", async () => {
      const result = await runWorkflow(
        createActivities(
          async (_input) => ({
            supplier: "SupplierA" as const,
            hotels: [
              { hotelId: "a1", name: "Expensive A", price: 12_000 },
              { hotelId: "a2", name: "Cheap A", price: 3_500 },
              { hotelId: "a3", name: "Mid A", price: 7_000 },
            ],
            attempts: 1,
            durationMs: 200,
          }),
          async () => successResult("SupplierB", 6_000),
        ),
      );

      // Must pick the cheapest hotel from A's response
      expect(result.cheapest?.price).toBe(3_500);
      expect(result.cheapest?.hotelId).toBe("a2");
    });
  });
});
