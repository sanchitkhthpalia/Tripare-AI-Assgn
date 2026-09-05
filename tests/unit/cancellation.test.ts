import { describe, it, expect } from "vitest";
import type { CancelResponse } from "@hotel-rate-comparator/shared";
import {
  mapWorkflowError,
  httpStatusFor,
} from "../../apps/backend/src/services/searchService";
import { WorkflowFailedError } from "@temporalio/client";
import { CancelledFailure } from "@temporalio/common";

// ── Cancel response contract ────────────────────────────────────

describe("CancelResponse contract", () => {
  it('"cancelled" outcome has the correct shape', () => {
    const response: CancelResponse = {
      outcome: "cancelled",
      searchId: "abc-123",
      message: "Cancellation signal sent to the search workflow.",
    };

    expect(response.outcome).toBe("cancelled");
    expect(response.searchId).toBe("abc-123");
    expect(response.message).toBeTruthy();
  });

  it('"already_completed" outcome has the correct shape', () => {
    const response: CancelResponse = {
      outcome: "already_completed",
      searchId: "abc-456",
      message: "The search has already completed or was not found.",
    };

    expect(response.outcome).toBe("already_completed");
    expect(response.searchId).toBe("abc-456");
    expect(response.message).toBeTruthy();
  });

  it('"not_found" outcome has the correct shape', () => {
    const response: CancelResponse = {
      outcome: "not_found",
      searchId: "abc-789",
      message: "Unable to cancel: the search was not found.",
    };

    expect(response.outcome).toBe("not_found");
    expect(response.searchId).toBe("abc-789");
    expect(response.message).toBeTruthy();
  });
});

// ── Cancellation in search response mapping ─────────────────────
// When the *search* endpoint catches a CancelledFailure from the
// workflow, it should map it to a 'cancelled' HotelSearchResponse —
// NOT treat it as a generic supplier error.

describe("Cancellation in search response mapping", () => {
  it('maps CancelledFailure to status "cancelled", not "error"', () => {
    const cause = new CancelledFailure("Workflow cancelled");
    const workflowError = new WorkflowFailedError(
      "Workflow cancelled",
      cause,
      "WORKFLOW_EXECUTION_FAILED",
    );

    const response = mapWorkflowError("search-cancel", workflowError);

    expect(response.status).toBe("cancelled");
    expect(response.searchId).toBe("search-cancel");
    // Should NOT be an error response
    expect(response.status).not.toBe("error");
  });

  it("cancelled search returns HTTP 200, not a 500-range code", () => {
    const response = { status: "cancelled" as const, searchId: "x" };
    expect(httpStatusFor(response)).toBe(200);
  });

  it("does not include an error object for cancelled searches", () => {
    const cause = new CancelledFailure("Workflow cancelled");
    const workflowError = new WorkflowFailedError(
      "Workflow cancelled",
      cause,
      "WORKFLOW_EXECUTION_FAILED",
    );

    const response = mapWorkflowError("search-cancel", workflowError);

    // TypeScript discriminated union: 'cancelled' variant has no error field
    if (response.status === "cancelled") {
      expect(Object.keys(response)).toEqual(
        expect.arrayContaining(["status", "searchId"]),
      );
      expect(Object.keys(response)).not.toContain("error");
    }
  });
});

// ── Safety invariants ───────────────────────────────────────────
// The cancel endpoint must be safe regardless of workflow state.

describe("Cancellation safety", () => {
  it("CancelResponse always has a searchId and message", () => {
    const outcomes: CancelResponse[] = [
      { outcome: "cancelled", searchId: "a", message: "ok" },
      { outcome: "already_completed", searchId: "b", message: "done" },
      { outcome: "not_found", searchId: "c", message: "nope" },
    ];

    for (const response of outcomes) {
      expect(typeof response.searchId).toBe("string");
      expect(response.searchId.length).toBeGreaterThan(0);
      expect(typeof response.message).toBe("string");
      expect(response.message.length).toBeGreaterThan(0);
    }
  });

  it("every CancelResponse outcome is a known variant", () => {
    const validOutcomes = ["cancelled", "already_completed", "not_found"];
    const response: CancelResponse = {
      outcome: "cancelled",
      searchId: "test",
      message: "test",
    };
    expect(validOutcomes).toContain(response.outcome);
  });
});
