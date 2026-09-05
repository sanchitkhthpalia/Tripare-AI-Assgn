/**
 * Search Execution State
 *
 * A structured model for the frontend to communicate search progress
 * honestly. Discriminated on `phase`:
 *
 *   idle → searching → completed | failed | cancelled
 *
 * Key principle: the "searching" phase shows only what we actually know
 * (that we're waiting for the backend). Per-supplier detail appears
 * only after the response arrives, because that's when the backend
 * actually knows.
 */

import type {
  Hotel,
  SupplierName,
  SupplierOutcome,
  SearchError,
  HotelSearchResponse,
} from "./types";

// ── Search phase states ─────────────────────────────────────────

export type SearchState =
  IdleState | SearchingState | CompletedState | FailedState | CancelledState;

export interface IdleState {
  phase: "idle";
}

/**
 * The search is in progress. We only know that the request was sent.
 * We do NOT know per-supplier status — that comes with the response.
 */
export interface SearchingState {
  phase: "searching";
  searchId: string;
  message: "Querying suppliers\u2026";
}

/**
 * The search completed with a result (or a "no hotels" result).
 * All supplier detail is now known and rendered.
 */
export interface CompletedState {
  phase: "completed";
  searchId: string;
  selectedSupplier: SupplierName | null;
  result: Hotel | null;
  reason: string;
  suppliers: {
    supplierA: SupplierStatusSummary;
    supplierB: SupplierStatusSummary;
  };
  warnings: string[];
  durationMs: number;
}

export interface FailedState {
  phase: "failed";
  searchId: string;
  error: SearchError;
  suppliers: {
    supplierA: SupplierStatusSummary;
    supplierB: SupplierStatusSummary;
  } | null;
}

export interface CancelledState {
  phase: "cancelled";
  searchId: string;
}

// ── Supplier status for UI rendering ────────────────────────────

/**
 * A UI-ready summary of what happened with one supplier.
 * Derived from SupplierOutcome — not fabricated by the frontend.
 */
export interface SupplierStatusSummary {
  supplier: SupplierName;
  status: "ok" | "empty" | "error" | "timeout";
  price: number | null;
  attempts: number;
  durationMs: number;
  /** Pre-formatted label, e.g. "✓ ₹3,500", "✗ Failed", "⏱ Timed out" */
  statusLabel: string;
  /** Only present when attempts > 1, e.g. "Retried (3 attempts)" */
  retryNote: string | null;
}

// ── Derivation functions ────────────────────────────────────────
// These bridge the API response to the UI state model.
// They live here (not in the frontend) so they're unit-testable.

/**
 * Converts a raw SupplierOutcome from the API into a UI-ready summary.
 */
export function toSupplierSummary(
  outcome: SupplierOutcome,
): SupplierStatusSummary {
  const base = {
    supplier: outcome.supplier,
    status: outcome.status,
    attempts: outcome.attempts,
    durationMs: outcome.durationMs,
    retryNote:
      outcome.attempts > 1 ? `Retried (${outcome.attempts} attempts)` : null,
  };

  switch (outcome.status) {
    case "ok":
      return {
        ...base,
        price: outcome.hotel.price,
        statusLabel: `\u2713 ₹${outcome.hotel.price.toLocaleString("en-IN")}`,
      };
    case "empty":
      return { ...base, price: null, statusLabel: "\u2205 No hotels" };
    case "error":
      return { ...base, price: null, statusLabel: "\u2717 Failed" };
    case "timeout":
      return { ...base, price: null, statusLabel: "\u23F1 Timed out" };
  }
}

/**
 * Derives user-facing warnings from the API response.
 * Warnings are informational — they don't block the result.
 */
export function deriveWarnings(
  supplierA: SupplierOutcome,
  supplierB: SupplierOutcome,
): string[] {
  const warnings: string[] = [];

  for (const outcome of [supplierA, supplierB]) {
    if (outcome.status === "error") {
      warnings.push(
        `${outcome.supplier} was unavailable and could not provide rates.`,
      );
    }
    if (outcome.status === "timeout") {
      warnings.push(
        `${outcome.supplier} did not respond within the timeout window.`,
      );
    }
    if (outcome.attempts > 1 && outcome.status === "ok") {
      warnings.push(
        `${outcome.supplier} required ${outcome.attempts} attempts before responding successfully.`,
      );
    }
  }

  return warnings;
}

/**
 * Maps an API response into the appropriate SearchState.
 * This is the single place where the API contract meets the UI model.
 */
export function responseToSearchState(
  response: HotelSearchResponse,
): SearchState {
  switch (response.status) {
    case "success":
    case "partial":
      return {
        phase: "completed",
        searchId: response.searchId,
        selectedSupplier: response.result.cheapest.supplier,
        result: response.result.cheapest,
        reason: response.result.reason,
        suppliers: {
          supplierA: toSupplierSummary(response.suppliers.supplierA),
          supplierB: toSupplierSummary(response.suppliers.supplierB),
        },
        warnings: deriveWarnings(
          response.suppliers.supplierA,
          response.suppliers.supplierB,
        ),
        durationMs: response.durationMs,
      };

    case "no_results":
      return {
        phase: "completed",
        searchId: response.searchId,
        selectedSupplier: null,
        result: null,
        reason: response.reason,
        suppliers: {
          supplierA: toSupplierSummary(response.suppliers.supplierA),
          supplierB: toSupplierSummary(response.suppliers.supplierB),
        },
        warnings: deriveWarnings(
          response.suppliers.supplierA,
          response.suppliers.supplierB,
        ),
        durationMs: response.durationMs,
      };

    case "error":
      return {
        phase: "failed",
        searchId: response.searchId,
        error: response.error,
        suppliers: response.suppliers
          ? {
              supplierA: toSupplierSummary(response.suppliers.supplierA),
              supplierB: toSupplierSummary(response.suppliers.supplierB),
            }
          : null,
      };

    case "cancelled":
      return {
        phase: "cancelled",
        searchId: response.searchId,
      };
  }
}
