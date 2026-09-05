// ---------------------------------------------------------------------------
// Domain primitives
// ---------------------------------------------------------------------------

/** The two mock suppliers the system queries in parallel. */
export type SupplierName = "SupplierA" | "SupplierB";

/** A hotel rate returned by a supplier. */
export interface Hotel {
  hotelId: string;
  name: string;
  price: number;
  supplier: SupplierName;
}

// ---------------------------------------------------------------------------
// Search request
// ---------------------------------------------------------------------------

/** Simulation scenario for a single mock supplier. */
export type SupplierScenario = "normal" | "slow" | "empty" | "error" | "retry";

/** What the frontend sends to POST /api/search-hotels. */
export interface HotelSearchRequest {
  /** Client-generated UUID for request correlation and cancellation. */
  searchId: string;
  city: string;
  checkIn: string; // ISO date, e.g. "2024-06-15"
  checkOut: string; // ISO date, e.g. "2024-06-18"
  /** Optional per-supplier scenario overrides for the mock suppliers. */
  scenarios?: {
    supplierA?: SupplierScenario;
    supplierB?: SupplierScenario;
  };
}

// ---------------------------------------------------------------------------
// Supplier-level outcome (returned by the workflow, not the HTTP mock)
// ---------------------------------------------------------------------------

/**
 * Discriminated union representing what happened with a single supplier.
 *
 * The `status` field drives both backend logic and frontend rendering:
 *   - "ok"      → supplier responded with at least one hotel
 *   - "empty"   → supplier responded but had no hotels for this search
 *   - "error"   → supplier returned a server error or was unreachable
 *   - "timeout" → activity exceeded the 5 s startToCloseTimeout
 */
export type SupplierOutcome =
  | {
      status: "ok";
      supplier: SupplierName;
      hotel: Hotel;
      attempts: number;
      durationMs: number;
    }
  | {
      status: "empty";
      supplier: SupplierName;
      attempts: number;
      durationMs: number;
    }
  | {
      status: "error";
      supplier: SupplierName;
      error: string;
      attempts: number;
      durationMs: number;
    }
  | {
      status: "timeout";
      supplier: SupplierName;
      error: string;
      attempts: number;
      durationMs: number;
    };

// ---------------------------------------------------------------------------
// Workflow result (what the Temporal workflow returns)
// ---------------------------------------------------------------------------

/**
 * The complete result of the hotel search workflow.
 *
 * `cheapest` is null when no supplier returned a bookable hotel.
 * `reason` is a human-readable sentence explaining the selection.
 */
export interface WorkflowResult {
  cheapest: Hotel | null;
  reason: string;
  suppliers: {
    supplierA: SupplierOutcome;
    supplierB: SupplierOutcome;
  };
}

// ---------------------------------------------------------------------------
// API response (what the Express endpoint returns to the frontend)
// ---------------------------------------------------------------------------

/**
 * Discriminated union for the search API response.
 *
 * `status` drives the frontend state machine:
 *   - "success" → at least one supplier returned a hotel, comparison complete
 *   - "partial" → one supplier failed but the other had a result
 *   - "no_results" → suppliers responded but no hotels matched
 *   - "error"   → both suppliers failed, nothing to show
 *   - "cancelled" → the user cancelled the search
 */
export type HotelSearchResponse =
  | {
      status: "success";
      searchId: string;
      result: { cheapest: Hotel; reason: string };
      suppliers: { supplierA: SupplierOutcome; supplierB: SupplierOutcome };
      durationMs: number;
    }
  | {
      status: "partial";
      searchId: string;
      result: { cheapest: Hotel; reason: string };
      suppliers: { supplierA: SupplierOutcome; supplierB: SupplierOutcome };
      durationMs: number;
    }
  | {
      status: "no_results";
      searchId: string;
      reason: string;
      suppliers: { supplierA: SupplierOutcome; supplierB: SupplierOutcome };
      durationMs: number;
    }
  | {
      status: "error";
      searchId: string;
      error: SearchError;
      suppliers?: { supplierA: SupplierOutcome; supplierB: SupplierOutcome };
    }
  | {
      status: "cancelled";
      searchId: string;
    };

// ---------------------------------------------------------------------------
// Cancel response
// ---------------------------------------------------------------------------

/**
 * Response from POST /api/search-hotels/:searchId/cancel.
 *
 * Discriminated on `outcome`:
 *   - "cancelled"         → workflow was running and received the cancel signal
 *   - "already_completed" → workflow finished before cancel arrived (safe no-op)
 *   - "not_found"         → no workflow with this searchId exists (safe no-op)
 */
export type CancelResponse =
  | { outcome: "cancelled"; searchId: string; message: string }
  | { outcome: "already_completed"; searchId: string; message: string }
  | { outcome: "not_found"; searchId: string; message: string };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Structured error codes the API can return. */
export type SearchErrorCode =
  | "ALL_SUPPLIERS_FAILED"
  | "SEARCH_CANCELLED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

/** Error payload in API responses. */
export interface SearchError {
  code: SearchErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Supplier activity I/O (used between the workflow and the activity)
// ---------------------------------------------------------------------------

/** Input to the single parameterized fetchSupplierHotels activity. */
export interface FetchSupplierInput {
  supplier: SupplierName;
  baseUrl: string;
  city: string;
  checkIn: string;
  checkOut: string;
  scenario?: SupplierScenario;
}

/** What the mock supplier HTTP endpoint returns. */
export interface SupplierHttpResponse {
  hotels: Array<{
    hotelId: string;
    name: string;
    price: number;
  }>;
}

/** What the activity returns to the workflow. */
export interface ActivityResult {
  supplier: SupplierName;
  hotels: Array<{
    hotelId: string;
    name: string;
    price: number;
  }>;
  attempts: number;
  durationMs: number;
}
