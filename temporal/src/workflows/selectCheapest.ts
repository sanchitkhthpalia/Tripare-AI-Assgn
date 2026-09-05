import type { Hotel, SupplierOutcome } from "@hotel-rate-comparator/shared";

/**
 * Pure, deterministic hotel rate comparison.
 *
 * Zero Temporal imports. Zero HTTP dependencies. Unit-testable in isolation.
 *
 * Business rules:
 *   1. A "successful" supplier (status: ok) contributed a bookable hotel.
 *   2. An "empty" supplier (status: empty) responded correctly but had
 *      nothing — this is NOT a failure, it's valid business data.
 *   3. A "failed" supplier (status: error | timeout) could not be reached
 *      or did not respond in time — we cannot draw conclusions from it.
 *   4. When comparing, only successful suppliers participate.
 *   5. On a price tie, Supplier A wins deterministically.
 *   6. "No hotels found" means every supplier that responded had nothing.
 *   7. "All suppliers failed" means no supplier responded at all.
 *      These are distinct outcomes — 6 is informational, 7 is an error.
 */

export interface SelectionResult {
  cheapest: Hotel | null;
  reason: string;
}

export function selectCheapest(
  outcomeA: SupplierOutcome,
  outcomeB: SupplierOutcome,
): SelectionResult {
  // ── Classify each supplier ────────────────────────────────────
  //
  //   "available"  →  status: ok  (has a bookable hotel)
  //   "responded"  →  status: ok | empty  (reached the supplier)
  //   "failed"     →  status: error | timeout  (could not reach)

  const hotelA = outcomeA.status === "ok" ? outcomeA.hotel : null;
  const hotelB = outcomeB.status === "ok" ? outcomeB.hotel : null;

  // ── Case 1: Both suppliers have a hotel → compare rates ──────
  if (hotelA && hotelB) {
    if (hotelA.price < hotelB.price) {
      return {
        cheapest: hotelA,
        reason: `Supplier A was selected because it returned the lowest rate (₹${hotelA.price.toLocaleString("en-IN")} vs ₹${hotelB.price.toLocaleString("en-IN")}).`,
      };
    }
    if (hotelB.price < hotelA.price) {
      return {
        cheapest: hotelB,
        reason: `Supplier B was selected because it returned the lowest rate (₹${hotelB.price.toLocaleString("en-IN")} vs ₹${hotelA.price.toLocaleString("en-IN")}).`,
      };
    }
    return {
      cheapest: hotelA,
      reason: `Supplier A was selected by default because both suppliers returned the same rate (₹${hotelA.price.toLocaleString("en-IN")}).`,
    };
  }

  // ── Case 2: Exactly one supplier has a hotel → use it ────────
  if (hotelA) {
    return {
      cheapest: hotelA,
      reason: `Supplier A was selected because ${describeAbsence(outcomeB)}.`,
    };
  }
  if (hotelB) {
    return {
      cheapest: hotelB,
      reason: `Supplier B was selected because ${describeAbsence(outcomeA)}.`,
    };
  }

  // ── Case 3: No supplier has a hotel ──────────────────────────
  //
  // Distinguish between "no hotels found" and "all suppliers failed":
  //   - If at least one supplier responded (ok or empty), we know
  //     there are genuinely no hotels → informational.
  //   - If every supplier failed, we can't conclude anything
  //     about availability → error.

  const aFailed = outcomeA.status === "error" || outcomeA.status === "timeout";
  const bFailed = outcomeB.status === "error" || outcomeB.status === "timeout";

  if (aFailed && bFailed) {
    return {
      cheapest: null,
      reason:
        "Unable to compare rates \u2014 both suppliers failed to respond.",
    };
  }

  return {
    cheapest: null,
    reason: "No hotels were found for this search.",
  };
}

/**
 * Describes why a supplier didn't contribute a hotel.
 * Phrased to read naturally after "because":
 *   "Supplier A was selected because Supplier B timed out."
 */
function describeAbsence(outcome: SupplierOutcome): string {
  switch (outcome.status) {
    case "ok":
      // Shouldn't reach here in practice — means both had hotels,
      // which is handled by Case 1 above.
      return `${outcome.supplier} also responded`;
    case "empty":
      return `${outcome.supplier} returned no hotels`;
    case "error":
      return `${outcome.supplier} failed to respond`;
    case "timeout":
      return `${outcome.supplier} timed out`;
  }
}
