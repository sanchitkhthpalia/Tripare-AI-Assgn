import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app, server } from "../../apps/backend/src/server";

describe("Health API", () => {
  afterAll(() => {
    // Shutdown the Express server gracefully
    server.close();
  });

  it("returns status 200 with an ok message", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.timestamp).toBe("string");
  });
});

// ── Mock supplier endpoints ──────────────────────────────────────
describe.each([
  ["SupplierA", "supplierA"],
  ["SupplierB", "supplierB"],
])("%s mock endpoint", (_name, prefix) => {
  const url = `/${prefix}/hotels`;

  it("returns hotels with hotelId, name and price", async () => {
    const res = await request(app).get(url).query({ city: "Goa" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hotels)).toBe(true);
    expect(res.body.hotels.length).toBeGreaterThan(0);

    for (const hotel of res.body.hotels) {
      expect(typeof hotel.hotelId).toBe("string");
      expect(typeof hotel.name).toBe("string");
      expect(typeof hotel.price).toBe("number");
      expect(hotel.price).toBeGreaterThan(0);
    }
  });

  it("returns 400 when city is missing", async () => {
    const res = await request(app).get(url);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("city");
  });

  it("returns an empty list for an unknown city", async () => {
    const res = await request(app).get(url).query({ city: "Atlantis" });

    expect(res.status).toBe(200);
    expect(res.body.hotels).toEqual([]);
  });

  it("matches the city case-insensitively", async () => {
    const lower = await request(app).get(url).query({ city: "goa" });
    const upper = await request(app).get(url).query({ city: "GOA" });

    expect(lower.body.hotels).toEqual(upper.body.hotels);
    expect(lower.body.hotels.length).toBeGreaterThan(0);
  });

  it("scenario=empty returns 200 with no hotels", async () => {
    const res = await request(app)
      .get(url)
      .query({ city: "Goa", scenario: "empty" });

    expect(res.status).toBe(200);
    expect(res.body.hotels).toEqual([]);
  });

  it("scenario=error returns a 500", async () => {
    const res = await request(app)
      .get(url)
      .query({ city: "Goa", scenario: "error" });

    expect(res.status).toBe(500);
  });

  it("scenario=retry fails on attempts 1-2 and succeeds on attempt 3", async () => {
    const first = await request(app)
      .get(url)
      .query({ city: "Goa", scenario: "retry", attempt: "1" });
    const second = await request(app)
      .get(url)
      .query({ city: "Goa", scenario: "retry", attempt: "2" });
    const third = await request(app)
      .get(url)
      .query({ city: "Goa", scenario: "retry", attempt: "3" });

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(third.status).toBe(200);
    expect(third.body.hotels.length).toBeGreaterThan(0);
  });

  it("falls back to normal for an unrecognised scenario", async () => {
    const res = await request(app)
      .get(url)
      .query({ city: "Goa", scenario: "not-a-real-scenario" });

    expect(res.status).toBe(200);
    expect(res.body.hotels.length).toBeGreaterThan(0);
  });
});

describe("supplier pricing", () => {
  it("prices the same hotel differently per supplier", async () => {
    const a = await request(app)
      .get("/supplierA/hotels")
      .query({ city: "Goa" });
    const b = await request(app)
      .get("/supplierB/hotels")
      .query({ city: "Goa" });

    const priceA = a.body.hotels.find(
      (h: { hotelId: string }) => h.hotelId === "goa-1",
    ).price;
    const priceB = b.body.hotels.find(
      (h: { hotelId: string }) => h.hotelId === "goa-1",
    ).price;

    // Without this the comparison logic would never have anything to compare.
    expect(priceA).not.toBe(priceB);
  });
});
