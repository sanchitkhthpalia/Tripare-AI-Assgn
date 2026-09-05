import { describe, it, expect } from "vitest";
import { selectCheapest } from "../../temporal/src/workflows/selectCheapest";
import type { SupplierOutcome } from "@hotel-rate-comparator/shared";

// ── Builders ────────────────────────────────────────────────────
// Each builder creates a specific supplier outcome. Using these
// instead of raw objects makes the test intent obvious at a glance.

function ok(
  supplier: "SupplierA" | "SupplierB",
  price: number,
): SupplierOutcome {
  return {
    status: "ok",
    supplier,
    hotel: {
      hotelId: `${supplier}-h1`,
      name: `${supplier} Hotel`,
      price,
      supplier,
    },
    attempts: 1,
    durationMs: 200,
  };
}

function empty(supplier: "SupplierA" | "SupplierB"): SupplierOutcome {
  return { status: "empty", supplier, attempts: 1, durationMs: 200 };
}

function error(supplier: "SupplierA" | "SupplierB"): SupplierOutcome {
  return {
    status: "error",
    supplier,
    error: "HTTP 500",
    attempts: 3,
    durationMs: 0,
  };
}

function timeout(supplier: "SupplierA" | "SupplierB"): SupplierOutcome {
  return {
    status: "timeout",
    supplier,
    error: "Activity timed out",
    attempts: 1,
    durationMs: 5000,
  };
}

function retried(
  supplier: "SupplierA" | "SupplierB",
  price: number,
): SupplierOutcome {
  return {
    status: "ok",
    supplier,
    hotel: {
      hotelId: `${supplier}-h1`,
      name: `${supplier} Hotel`,
      price,
      supplier,
    },
    attempts: 3,
    durationMs: 1500,
  };
}

// ── Assignment scenarios ────────────────────────────────────────

describe("selectCheapest", () => {
  // ─────────────────────────────────────────────────────────────
  // Scenario: Both suppliers succeed — compare rates
  // ─────────────────────────────────────────────────────────────

  describe("both suppliers return hotels", () => {
    it("picks Supplier A when A has the lower rate", () => {
      const result = selectCheapest(ok("SupplierA", 120), ok("SupplierB", 150));
      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.cheapest?.price).toBe(120);
      expect(result.reason).toContain("lowest rate");
      expect(result.reason).toContain("₹120");
      expect(result.reason).toContain("₹150");
    });

    it("picks Supplier B when B has the lower rate", () => {
      const result = selectCheapest(ok("SupplierA", 200), ok("SupplierB", 150));
      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.cheapest?.price).toBe(150);
      expect(result.reason).toContain("lowest rate");
    });

    it("picks Supplier A deterministically on a price tie", () => {
      const result = selectCheapest(ok("SupplierA", 100), ok("SupplierB", 100));
      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.reason).toContain("same rate");
      expect(result.reason).toContain("by default");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario: One supplier fails, the other succeeds
  // ─────────────────────────────────────────────────────────────

  describe("one supplier fails", () => {
    it("returns B when A errors", () => {
      const result = selectCheapest(error("SupplierA"), ok("SupplierB", 150));
      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.reason).toContain("SupplierA failed");
    });

    it("returns A when B errors", () => {
      const result = selectCheapest(ok("SupplierA", 120), error("SupplierB"));
      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.reason).toContain("SupplierB failed");
    });

    it("returns B when A times out", () => {
      const result = selectCheapest(timeout("SupplierA"), ok("SupplierB", 200));
      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.reason).toContain("SupplierA timed out");
    });

    it("returns A when B times out", () => {
      const result = selectCheapest(ok("SupplierA", 200), timeout("SupplierB"));
      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.reason).toContain("SupplierB timed out");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario: One supplier returns empty (valid response, no hotels)
  // ─────────────────────────────────────────────────────────────

  describe("one supplier returns empty", () => {
    it("returns A when B is empty", () => {
      const result = selectCheapest(ok("SupplierA", 120), empty("SupplierB"));
      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.reason).toContain("SupplierB returned no hotels");
    });

    it("returns B when A is empty", () => {
      const result = selectCheapest(empty("SupplierA"), ok("SupplierB", 120));
      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.reason).toContain("SupplierA returned no hotels");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario: Neither supplier returned a bookable hotel
  //
  // This is the critical distinction the function must make:
  //   "no hotels found"     → at least one supplier responded
  //   "all suppliers failed" → no supplier could be reached
  // ─────────────────────────────────────────────────────────────

  describe("no bookable hotels", () => {
    it('reports "no hotels" when both suppliers return empty arrays', () => {
      const result = selectCheapest(empty("SupplierA"), empty("SupplierB"));
      expect(result.cheapest).toBeNull();
      expect(result.reason).toContain("No hotels");
      expect(result.reason).not.toContain("failed");
    });

    it('reports "no hotels" when one is empty and one errored', () => {
      // The empty supplier DID respond — we know there are no hotels.
      // The failed supplier is irrelevant to that conclusion.
      const result = selectCheapest(empty("SupplierA"), error("SupplierB"));
      expect(result.cheapest).toBeNull();
      expect(result.reason).toContain("No hotels");
    });

    it('reports "no hotels" when one is empty and one timed out', () => {
      const result = selectCheapest(timeout("SupplierA"), empty("SupplierB"));
      expect(result.cheapest).toBeNull();
      expect(result.reason).toContain("No hotels");
    });

    it('reports "all failed" when both suppliers error', () => {
      // Neither supplier could be reached — we know nothing.
      const result = selectCheapest(error("SupplierA"), error("SupplierB"));
      expect(result.cheapest).toBeNull();
      expect(result.reason).toContain("both suppliers failed");
    });

    it('reports "all failed" when both suppliers time out', () => {
      const result = selectCheapest(timeout("SupplierA"), timeout("SupplierB"));
      expect(result.cheapest).toBeNull();
      expect(result.reason).toContain("both suppliers failed");
    });

    it('reports "all failed" when one errors and one times out', () => {
      const result = selectCheapest(error("SupplierA"), timeout("SupplierB"));
      expect(result.cheapest).toBeNull();
      expect(result.reason).toContain("both suppliers failed");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Scenario: Retry succeeded
  // ─────────────────────────────────────────────────────────────

  describe("retry behavior", () => {
    it("selects a supplier that succeeded after retries", () => {
      const result = selectCheapest(
        retried("SupplierA", 120),
        ok("SupplierB", 150),
      );
      // Retried supplier still wins on price — retries don't penalize.
      expect(result.cheapest?.supplier).toBe("SupplierA");
      expect(result.cheapest?.price).toBe(120);
    });

    it("compares prices normally when both required retries", () => {
      const result = selectCheapest(
        retried("SupplierA", 200),
        retried("SupplierB", 130),
      );
      expect(result.cheapest?.supplier).toBe("SupplierB");
      expect(result.cheapest?.price).toBe(130);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Invariants
  // ─────────────────────────────────────────────────────────────

  describe("invariants", () => {
    it("reason is always a non-empty string", () => {
      const cases: [SupplierOutcome, SupplierOutcome][] = [
        [ok("SupplierA", 100), ok("SupplierB", 200)],
        [ok("SupplierA", 100), ok("SupplierB", 100)],
        [ok("SupplierA", 100), empty("SupplierB")],
        [ok("SupplierA", 100), error("SupplierB")],
        [ok("SupplierA", 100), timeout("SupplierB")],
        [empty("SupplierA"), empty("SupplierB")],
        [error("SupplierA"), error("SupplierB")],
        [empty("SupplierA"), error("SupplierB")],
      ];

      for (const [a, b] of cases) {
        const result = selectCheapest(a, b);
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });

    it("cheapest hotel always has the correct supplier field", () => {
      const resultA = selectCheapest(
        ok("SupplierA", 100),
        ok("SupplierB", 200),
      );
      expect(resultA.cheapest?.supplier).toBe("SupplierA");

      const resultB = selectCheapest(
        ok("SupplierA", 200),
        ok("SupplierB", 100),
      );
      expect(resultB.cheapest?.supplier).toBe("SupplierB");
    });
  });
});
