import { describe, it, expect } from "vitest";
import {
  mapWorkflowResult,
  mapWorkflowError,
  httpStatusFor,
} from "../../apps/backend/src/services/searchService";
import type {
  WorkflowResult,
  SupplierOutcome,
  HotelSearchResponse,
} from "@hotel-rate-comparator/shared";
import { WorkflowFailedError } from "@temporalio/client";
import { ApplicationFailure, CancelledFailure } from "@temporalio/common";

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

const errorA: SupplierOutcome = {
  status: "error",
  supplier: "SupplierA",
  error: "HTTP 500",
  attempts: 3,
  durationMs: 0,
};

const emptyA: SupplierOutcome = {
  status: "empty",
  supplier: "SupplierA",
  attempts: 1,
  durationMs: 200,
};

const emptyB: SupplierOutcome = {
  status: "empty",
  supplier: "SupplierB",
  attempts: 1,
  durationMs: 200,
};

// ── mapWorkflowResult ───────────────────────────────────────────

describe("mapWorkflowResult", () => {
  it('returns "success" when both suppliers responded with hotels', () => {
    const result: WorkflowResult = {
      cheapest: okA.hotel,
      reason: "A was cheapest",
      suppliers: { supplierA: okA, supplierB: okB },
    };

    const response = mapWorkflowResult("search-1", result, 450);
    expect(response.status).toBe("success");
    expect(response.searchId).toBe("search-1");

    if (response.status === "success") {
      expect(response.result.cheapest.price).toBe(120);
      expect(response.result.cheapest.supplier).toBe("SupplierA");
      expect(response.result.reason).toBe("A was cheapest");
      expect(response.durationMs).toBe(450);
    }
  });

  it('returns "partial" when one supplier failed but a result exists', () => {
    const result: WorkflowResult = {
      cheapest: okB.hotel,
      reason: "A failed",
      suppliers: { supplierA: errorA, supplierB: okB },
    };

    const response = mapWorkflowResult("search-2", result, 5100);
    expect(response.status).toBe("partial");

    if (response.status === "partial") {
      expect(response.result.cheapest.supplier).toBe("SupplierB");
      expect(response.suppliers.supplierA.status).toBe("error");
    }
  });

  it('returns "no_results" when both suppliers returned empty', () => {
    const result: WorkflowResult = {
      cheapest: null,
      reason: "No hotels found",
      suppliers: { supplierA: emptyA, supplierB: emptyB },
    };

    const response = mapWorkflowResult("search-3", result, 400);
    expect(response.status).toBe("no_results");

    if (response.status === "no_results") {
      expect(response.reason).toBe("No hotels found");
      expect(response.durationMs).toBe(400);
    }
  });
});

// ── mapWorkflowError ────────────────────────────────────────────

describe("mapWorkflowError", () => {
  it('returns "error" with ALL_SUPPLIERS_FAILED for domain failures', () => {
    const cause = ApplicationFailure.nonRetryable(
      "Both suppliers down",
      "ALL_SUPPLIERS_FAILED",
    );
    const workflowError = new WorkflowFailedError(
      "Workflow execution failed",
      cause,
      "WORKFLOW_EXECUTION_FAILED",
    );

    const response = mapWorkflowError("search-4", workflowError);
    expect(response.status).toBe("error");

    if (response.status === "error") {
      expect(response.error.code).toBe("ALL_SUPPLIERS_FAILED");
      expect(response.error.message).toContain("Both suppliers");
    }
  });

  it('returns "cancelled" for workflow cancellation', () => {
    const cause = new CancelledFailure("Workflow cancelled");
    const workflowError = new WorkflowFailedError(
      "Workflow cancelled",
      cause,
      "WORKFLOW_EXECUTION_FAILED",
    );

    const response = mapWorkflowError("search-5", workflowError);
    expect(response.status).toBe("cancelled");
    expect(response.searchId).toBe("search-5");
  });

  it('returns "error" with INTERNAL_ERROR for unexpected errors', () => {
    const response = mapWorkflowError("search-6", new Error("Something broke"));
    expect(response.status).toBe("error");

    if (response.status === "error") {
      expect(response.error.code).toBe("INTERNAL_ERROR");
    }
  });
});

// ── httpStatusFor ───────────────────────────────────────────────

describe("httpStatusFor", () => {
  it("returns 200 for success", () => {
    expect(httpStatusFor({ status: "success" } as HotelSearchResponse)).toBe(
      200,
    );
  });

  it("returns 200 for partial", () => {
    expect(httpStatusFor({ status: "partial" } as HotelSearchResponse)).toBe(
      200,
    );
  });

  it("returns 200 for no_results", () => {
    expect(httpStatusFor({ status: "no_results" } as HotelSearchResponse)).toBe(
      200,
    );
  });

  it("returns 200 for cancelled", () => {
    expect(httpStatusFor({ status: "cancelled" } as HotelSearchResponse)).toBe(
      200,
    );
  });

  it("returns 502 for ALL_SUPPLIERS_FAILED", () => {
    const response: HotelSearchResponse = {
      status: "error",
      searchId: "x",
      error: { code: "ALL_SUPPLIERS_FAILED", message: "" },
    };
    expect(httpStatusFor(response)).toBe(502);
  });

  it("returns 500 for INTERNAL_ERROR", () => {
    const response: HotelSearchResponse = {
      status: "error",
      searchId: "x",
      error: { code: "INTERNAL_ERROR", message: "" },
    };
    expect(httpStatusFor(response)).toBe(500);
  });
});
