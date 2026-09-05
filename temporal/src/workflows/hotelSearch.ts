/**
 * Hotel Search Workflow
 *
 * Orchestrates a hotel rate comparison across two suppliers.
 *
 * Flow:
 *   1. Fan out to Supplier A and Supplier B in parallel.
 *   2. Wait for both to settle (Promise.allSettled, never Promise.all).
 *   3. If both were cancelled → re-throw to preserve workflow cancellation.
 *   4. Map each settled result into a typed SupplierOutcome.
 *   5. If both suppliers hard-failed → throw ALL_SUPPLIERS_FAILED.
 *   6. Otherwise → compare rates and return the cheapest.
 *
 * This file contains zero side effects: no HTTP calls, no Date.now(),
 * no Math.random(), no logging. All I/O happens in activities.
 */

import {
  proxyActivities,
  ApplicationFailure,
  isCancellation,
  workflowInfo,
  log,
} from "@temporalio/workflow";
import type {
  HotelSearchRequest,
  WorkflowResult,
  SupplierOutcome,
  SupplierName,
  ActivityResult,
} from "@hotel-rate-comparator/shared";
import type * as activities from "../activities/fetchSupplier";
import { selectCheapest } from "./selectCheapest";

// ── Activity configuration ──────────────────────────────────────
// In production these URLs would come from a config service or
// workflow arguments. For this take-home they're constants.

const SUPPLIER_A_URL = "http://localhost:4000/supplierA/hotels";
const SUPPLIER_B_URL = "http://localhost:4000/supplierB/hotels";

/** Mirrors `retry.maximumAttempts` below; used to report attempt counts. */
const MAX_ATTEMPTS = 3;

const { fetchSupplierHotels } = proxyActivities<typeof activities>({
  // Safety net above the activity's own 5s deadline.
  startToCloseTimeout: "6s",
  // Ceiling across all attempts.
  scheduleToCloseTimeout: "8s",

  retry: {
    maximumAttempts: MAX_ATTEMPTS,
    initialInterval: "500ms",
    backoffCoefficient: 2,
    maximumInterval: "2s",
    // Retrying these cannot change the outcome.
    nonRetryableErrorTypes: ["SUPPLIER_TIMEOUT", "SUPPLIER_BAD_REQUEST"],
  },
});

// ── Workflow entry point ────────────────────────────────────────

export async function hotelSearchWorkflow(
  request: HotelSearchRequest,
): Promise<WorkflowResult> {
  const info = workflowInfo();
  // workflowId is formatted as "hotel-search-<searchId>"
  const searchId = request.searchId;

  log.info(
    JSON.stringify({
      event: "workflow_started",
      searchId,
      workflowId: info.workflowId,
    }),
  );
  // Step 1: Fan out to both suppliers in parallel.
  // Promise.allSettled ensures one supplier's failure never
  // aborts the other supplier's in-flight request.
  const [settledA, settledB] = await Promise.allSettled([
    fetchSupplierHotels({
      supplier: "SupplierA",
      baseUrl: SUPPLIER_A_URL,
      city: request.city,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      scenario: request.scenarios?.supplierA,
    }),
    fetchSupplierHotels({
      supplier: "SupplierB",
      baseUrl: SUPPLIER_B_URL,
      city: request.city,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      scenario: request.scenarios?.supplierB,
    }),
  ]);

  // Step 2: If either activity was cancelled, complete as CANCELLED.
  for (const settled of [settledA, settledB]) {
    if (settled.status === "rejected" && isCancellation(settled.reason)) {
      throw settled.reason;
    }
  }

  // Step 3: Convert settled results into typed supplier outcomes.
  const outcomeA = toSupplierOutcome("SupplierA", settledA);
  const outcomeB = toSupplierOutcome("SupplierB", settledB);

  // Step 4: If both suppliers hard-failed, throw a domain error.
  const bothFailed =
    (outcomeA.status === "error" || outcomeA.status === "timeout") &&
    (outcomeB.status === "error" || outcomeB.status === "timeout");

  if (bothFailed) {
    throw ApplicationFailure.nonRetryable(
      "Both suppliers failed to respond",
      "ALL_SUPPLIERS_FAILED",
    );
  }

  // Step 5: At least one supplier returned data. Compare and pick cheapest.
  const { cheapest, reason } = selectCheapest(outcomeA, outcomeB);

  const result = {
    cheapest,
    reason,
    suppliers: { supplierA: outcomeA, supplierB: outcomeB },
  };

  log.info(JSON.stringify({ event: "workflow_completed", searchId }));
  return result;
}

// ── Helpers (private, no side effects) ──────────────────────────

/**
 * Maps a Promise.allSettled result into a typed SupplierOutcome.
 */
function toSupplierOutcome(
  supplier: SupplierName,
  settled: PromiseSettledResult<ActivityResult>,
): SupplierOutcome {
  if (settled.status === "fulfilled") {
    const { hotels, attempts, durationMs } = settled.value;

    if (hotels.length === 0) {
      return { status: "empty", supplier, attempts, durationMs };
    }

    // Pick the cheapest hotel from this supplier's response.
    const cheapest = hotels.reduce((best, h) =>
      h.price < best.price ? h : best,
    );

    return {
      status: "ok",
      supplier,
      hotel: { ...cheapest, supplier },
      attempts,
      durationMs,
    };
  }

  // Rejected — determine if it was a timeout or a general error.
  const error = settled.reason;

  // Either our own SUPPLIER_TIMEOUT or Temporal's timeout safety net.
  const isTimeout =
    hasFailureType(error, "SUPPLIER_TIMEOUT") || hasTimeoutCause(error);

  const nonRetryable =
    isTimeout || hasFailureType(error, "SUPPLIER_BAD_REQUEST");

  return {
    status: isTimeout ? "timeout" : "error",
    supplier,
    error: extractMessage(error),
    // Non-retryable failures stop on attempt 1; others exhaust the policy.
    attempts: nonRetryable ? 1 : MAX_ATTEMPTS,
    durationMs: 0,
  };
}

/**
 * Walks the cause chain looking for an ApplicationFailure of a given type.
 */
function hasFailureType(error: unknown, type: string): boolean {
  let current: unknown = error;
  while (current != null && typeof current === "object") {
    if ((current as { type?: unknown }).type === type) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Walks the cause chain looking for a TimeoutFailure.
 * Uses duck typing (name check) rather than instanceof to work
 * reliably across the workflow sandbox bundling boundary.
 */
function hasTimeoutCause(error: unknown): boolean {
  let current: unknown = error;
  while (current != null && typeof current === "object") {
    const obj = current as Record<string, unknown>;
    if (
      obj["name"] === "TimeoutFailure" ||
      (typeof obj["constructor"] === "function" &&
        (obj["constructor"] as { name?: string }).name === "TimeoutFailure")
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Extracts a human-readable message from a Temporal error chain.
 * Walks to the deepest cause for the most specific message.
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    let current: Error = error;
    while (current.cause instanceof Error) {
      current = current.cause;
    }
    return current.message;
  }
  return String(error);
}
