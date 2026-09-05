import { describe, it, expect } from "vitest";
import {
  searchRequestSchema,
  formatValidationErrors,
} from "../../apps/backend/src/middleware/validate";

// ── Helper ──────────────────────────────────────────────────────

function validate(body: Record<string, unknown>) {
  const result = searchRequestSchema.safeParse(body);
  if (result.success) return { ok: true, data: result.data, errors: [] };
  return {
    ok: false,
    data: null,
    errors: formatValidationErrors(result.error),
  };
}

const VALID_BODY = {
  city: "New York",
  checkIn: "2026-10-10",
  checkOut: "2026-10-15",
};

// ── Tests ───────────────────────────────────────────────────────

describe("Search Request Validation", () => {
  // ── Valid requests ────────────────────────────────────────────

  it("accepts a valid request", () => {
    const result = validate(VALID_BODY);
    expect(result.ok).toBe(true);
    expect(result.data!.city).toBe("New York");
  });

  it("rejects a searchId that is not a UUID", () => {
    // searchId becomes the Temporal workflowId, so it must be constrained.
    const result = validate({ ...VALID_BODY, searchId: "abc-123" });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("UUID"))).toBe(true);
  });

  it("accepts optional searchId", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const result = validate({ ...VALID_BODY, searchId: uuid });
    expect(result.ok).toBe(true);
    expect(result.data!.searchId).toBe(uuid);
  });

  it("accepts optional scenarios", () => {
    const result = validate({
      ...VALID_BODY,
      scenarios: { supplierA: "slow", supplierB: "error" },
    });
    expect(result.ok).toBe(true);
    expect(result.data!.scenarios?.supplierA).toBe("slow");
  });

  it("trims whitespace from city", () => {
    const result = validate({ ...VALID_BODY, city: "  Paris  " });
    expect(result.ok).toBe(true);
    expect(result.data!.city).toBe("Paris");
  });

  // ── Missing required fields ───────────────────────────────────

  it("rejects missing city", () => {
    const result = validate({ checkIn: "2026-10-10", checkOut: "2026-10-15" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("City"))).toBe(true);
  });

  it("rejects empty city", () => {
    const result = validate({ ...VALID_BODY, city: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("City"))).toBe(true);
  });

  it("rejects whitespace-only city", () => {
    const result = validate({ ...VALID_BODY, city: "   " });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("City"))).toBe(true);
  });

  it("rejects missing check-in date", () => {
    const result = validate({ city: "Paris", checkOut: "2026-10-15" });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.toLowerCase().includes("check-in")),
    ).toBe(true);
  });

  it("rejects missing check-out date", () => {
    const result = validate({ city: "Paris", checkIn: "2026-10-10" });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.toLowerCase().includes("check-out")),
    ).toBe(true);
  });

  // ── Invalid date formats ──────────────────────────────────────

  it("rejects non-ISO date format for check-in", () => {
    const result = validate({ ...VALID_BODY, checkIn: "10/10/2026" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("YYYY-MM-DD"))).toBe(true);
  });

  it("rejects non-ISO date format for check-out", () => {
    const result = validate({ ...VALID_BODY, checkOut: "October 15" });
    expect(result.ok).toBe(false);
  });

  // ── Invalid calendar dates ────────────────────────────────────

  it("rejects February 30 (valid format, invalid date)", () => {
    const result = validate({ ...VALID_BODY, checkIn: "2026-02-30" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("valid calendar date"))).toBe(
      true,
    );
  });

  it("rejects month 13", () => {
    const result = validate({ ...VALID_BODY, checkIn: "2026-13-01" });
    expect(result.ok).toBe(false);
  });

  // ── Date ordering ─────────────────────────────────────────────

  it("rejects check-out before check-in", () => {
    const result = validate({
      city: "Paris",
      checkIn: "2026-10-15",
      checkOut: "2026-10-10",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("after"))).toBe(true);
  });

  it("rejects check-out equal to check-in (zero-night stay)", () => {
    const result = validate({
      city: "Paris",
      checkIn: "2026-10-10",
      checkOut: "2026-10-10",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("after"))).toBe(true);
  });

  // ── Invalid scenario values ───────────────────────────────────

  it("rejects invalid scenario values", () => {
    const result = validate({
      ...VALID_BODY,
      scenarios: { supplierA: "chaos" },
    });
    expect(result.ok).toBe(false);
  });
});
