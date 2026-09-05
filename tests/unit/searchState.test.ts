import { describe, it, expect } from "vitest";
import {
  toSupplierSummary,
  deriveWarnings,
  responseToSearchState,
} from "../../packages/shared/src/searchState";
import type {
  SupplierOutcome,
  HotelSearchResponse,
  CompletedState,
  FailedState,
  CancelledState,
} from "@hotel-rate-comparator/shared";

// ── Fixtures ────────────────────────────────────────────────────

const okA: SupplierOutcome = {
  status: "ok",
  supplier: "SupplierA",
  hotel: {
    hotelId: "h1",
    name: "Grand Hotel",
    price: 120,
    supplier: "SupplierA",
  },
  attempts: 1,
  durationMs: 234,
};

const okB: SupplierOutcome = {
  status: "ok",
  supplier: "SupplierB",
  hotel: {
    hotelId: "h1",
    name: "Grand Hotel",
    price: 145,
    supplier: "SupplierB",
  },
  attempts: 1,
  durationMs: 410,
};

const retriedA: SupplierOutcome = {
  status: "ok",
  supplier: "SupplierA",
  hotel: {
    hotelId: "h1",
    name: "Grand Hotel",
    price: 120,
    supplier: "SupplierA",
  },
  attempts: 3,
  durationMs: 1500,
};

const emptyB: SupplierOutcome = {
  status: "empty",
  supplier: "SupplierB",
  attempts: 1,
  durationMs: 200,
};

const errorA: SupplierOutcome = {
  status: "error",
  supplier: "SupplierA",
  error: "HTTP 500",
  attempts: 3,
  durationMs: 0,
};

const timeoutB: SupplierOutcome = {
  status: "timeout",
  supplier: "SupplierB",
  error: "Activity timed out",
  attempts: 1,
  durationMs: 5000,
};

// ── toSupplierSummary ───────────────────────────────────────────

describe("toSupplierSummary", () => {
  it("formats ok status with price", () => {
    const summary = toSupplierSummary(okA);
    expect(summary.status).toBe("ok");
    expect(summary.price).toBe(120);
    expect(summary.statusLabel).toBe("✓ ₹120");
    expect(summary.retryNote).toBeNull();
  });

  it("formats empty status", () => {
    const summary = toSupplierSummary(emptyB);
    expect(summary.status).toBe("empty");
    expect(summary.price).toBeNull();
    expect(summary.statusLabel).toBe("∅ No hotels");
  });

  it("formats error status", () => {
    const summary = toSupplierSummary(errorA);
    expect(summary.status).toBe("error");
    expect(summary.price).toBeNull();
    expect(summary.statusLabel).toBe("✗ Failed");
  });

  it("formats timeout status", () => {
    const summary = toSupplierSummary(timeoutB);
    expect(summary.status).toBe("timeout");
    expect(summary.price).toBeNull();
    expect(summary.statusLabel).toBe("⏱ Timed out");
  });

  it("includes retry note when attempts > 1", () => {
    const summary = toSupplierSummary(retriedA);
    expect(summary.retryNote).toBe("Retried (3 attempts)");
  });

  it("no retry note when attempts = 1", () => {
    const summary = toSupplierSummary(okA);
    expect(summary.retryNote).toBeNull();
  });
});

// ── deriveWarnings ──────────────────────────────────────────────

describe("deriveWarnings", () => {
  it("returns empty array when both suppliers are ok", () => {
    expect(deriveWarnings(okA, okB)).toEqual([]);
  });

  it("warns when a supplier errored", () => {
    const warnings = deriveWarnings(errorA, okB);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SupplierA");
    expect(warnings[0]).toContain("unavailable");
  });

  it("warns when a supplier timed out", () => {
    const warnings = deriveWarnings(okA, timeoutB);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SupplierB");
    expect(warnings[0]).toContain("timeout");
  });

  it("warns when a supplier required retries", () => {
    const warnings = deriveWarnings(retriedA, okB);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SupplierA");
    expect(warnings[0]).toContain("3 attempts");
  });

  it("returns multiple warnings when appropriate", () => {
    const warnings = deriveWarnings(errorA, timeoutB);
    expect(warnings).toHaveLength(2);
  });

  it("does not warn on empty status", () => {
    const warnings = deriveWarnings(okA, emptyB);
    expect(warnings).toEqual([]);
  });
});

// ── responseToSearchState ───────────────────────────────────────

describe("responseToSearchState", () => {
  it("maps a success response to completed state", () => {
    const response: HotelSearchResponse = {
      status: "success",
      searchId: "abc-123",
      result: { cheapest: okA.hotel, reason: "A was cheaper" },
      suppliers: { supplierA: okA, supplierB: okB },
      durationMs: 450,
    };

    const state = responseToSearchState(response);
    expect(state.phase).toBe("completed");

    const completed = state as CompletedState;
    expect(completed.searchId).toBe("abc-123");
    expect(completed.selectedSupplier).toBe("SupplierA");
    expect(completed.result?.price).toBe(120);
    expect(completed.reason).toBe("A was cheaper");
    expect(completed.durationMs).toBe(450);
    expect(completed.suppliers.supplierA.statusLabel).toBe("✓ ₹120");
    expect(completed.suppliers.supplierB.statusLabel).toBe("✓ ₹145");
    expect(completed.warnings).toEqual([]);
  });

  it("maps a partial response to completed state with warnings", () => {
    const response: HotelSearchResponse = {
      status: "partial",
      searchId: "abc-456",
      result: { cheapest: okB.hotel, reason: "A failed" },
      suppliers: { supplierA: errorA, supplierB: okB },
      durationMs: 5100,
    };

    const state = responseToSearchState(response);
    expect(state.phase).toBe("completed");

    const completed = state as CompletedState;
    expect(completed.selectedSupplier).toBe("SupplierB");
    expect(completed.warnings.length).toBeGreaterThan(0);
    expect(completed.suppliers.supplierA.statusLabel).toBe("✗ Failed");
  });

  it("maps a no_results response to completed state with null result", () => {
    const response: HotelSearchResponse = {
      status: "no_results",
      searchId: "abc-789",
      reason: "No hotels found",
      suppliers: { supplierA: emptyB, supplierB: emptyB },
      durationMs: 400,
    };

    const state = responseToSearchState(response);
    expect(state.phase).toBe("completed");

    const completed = state as CompletedState;
    expect(completed.result).toBeNull();
    expect(completed.selectedSupplier).toBeNull();
  });

  it("maps an error response to failed state", () => {
    const response: HotelSearchResponse = {
      status: "error",
      searchId: "abc-err",
      error: { code: "ALL_SUPPLIERS_FAILED", message: "Both failed" },
      suppliers: { supplierA: errorA, supplierB: timeoutB },
    };

    const state = responseToSearchState(response);
    expect(state.phase).toBe("failed");

    const failed = state as FailedState;
    expect(failed.error.code).toBe("ALL_SUPPLIERS_FAILED");
    expect(failed.suppliers).not.toBeNull();
    expect(failed.suppliers!.supplierA.statusLabel).toBe("✗ Failed");
    expect(failed.suppliers!.supplierB.statusLabel).toBe("⏱ Timed out");
  });

  it("maps a cancelled response to cancelled state", () => {
    const response: HotelSearchResponse = {
      status: "cancelled",
      searchId: "abc-cancel",
    };

    const state = responseToSearchState(response);
    expect(state.phase).toBe("cancelled");
    expect((state as CancelledState).searchId).toBe("abc-cancel");
  });
});
