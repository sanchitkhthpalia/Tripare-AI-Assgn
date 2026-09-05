import type {
  WorkflowResult,
  HotelSearchResponse,
} from "@hotel-rate-comparator/shared";
import { WorkflowFailedError } from "@temporalio/client";
import { ApplicationFailure, CancelledFailure } from "@temporalio/common";

/**
 * Maps a successful WorkflowResult into the API response shape.
 *
 * This is a pure function — no I/O, no Temporal calls, fully testable.
 */
export function mapWorkflowResult(
  searchId: string,
  result: WorkflowResult,
  durationMs: number,
): HotelSearchResponse {
  const { cheapest, reason, suppliers } = result;

  // ── A hotel was found ─────────────────────────────────────────
  if (cheapest) {
    const someSupplierFailed =
      suppliers.supplierA.status === "error" ||
      suppliers.supplierA.status === "timeout" ||
      suppliers.supplierB.status === "error" ||
      suppliers.supplierB.status === "timeout";

    return {
      status: someSupplierFailed ? "partial" : "success",
      searchId,
      result: { cheapest, reason },
      suppliers,
      durationMs,
    };
  }

  // ── No hotel found (both suppliers responded but had nothing) ─
  return {
    status: "no_results",
    searchId,
    reason,
    suppliers,
    durationMs,
  };
}

/**
 * Maps a workflow error into a structured API error response.
 *
 * Distinguishes between:
 *   - ALL_SUPPLIERS_FAILED (domain error → 502)
 *   - Cancellation (user action → 200)
 *   - Unexpected errors (internal → 500)
 */
export function mapWorkflowError(
  searchId: string,
  error: unknown,
): HotelSearchResponse {
  // Duplicate searchId is a client mistake, not a server fault.
  if (
    error != null &&
    typeof error === "object" &&
    (error as { name?: unknown }).name ===
      "WorkflowExecutionAlreadyStartedError"
  ) {
    return {
      status: "error",
      searchId,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "A search with this searchId is already running or has completed. Use a fresh searchId.",
      },
    };
  }

  if (error instanceof WorkflowFailedError) {
    // Cancellation
    if (error.cause instanceof CancelledFailure) {
      return { status: "cancelled", searchId };
    }

    // Domain error from the workflow
    if (
      error.cause instanceof ApplicationFailure &&
      error.cause.type === "ALL_SUPPLIERS_FAILED"
    ) {
      return {
        status: "error",
        searchId,
        error: {
          code: "ALL_SUPPLIERS_FAILED",
          message: error.cause.message,
        },
      };
    }
  }

  // Unexpected error
  return {
    status: "error",
    searchId,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred while processing the search.",
    },
  };
}

/**
 * Maps a response status to the appropriate HTTP status code.
 */
export function httpStatusFor(response: HotelSearchResponse): number {
  switch (response.status) {
    case "success":
    case "partial":
    case "no_results":
    case "cancelled":
      return 200;
    case "error":
      if (response.error.code === "ALL_SUPPLIERS_FAILED") return 502;
      if (response.error.code === "VALIDATION_ERROR") return 400;
      return 500;
  }
}
