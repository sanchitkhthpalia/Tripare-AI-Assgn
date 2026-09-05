export type {
  // Domain primitives
  SupplierName,
  Hotel,

  // Search request
  SupplierScenario,
  HotelSearchRequest,

  // Supplier outcome
  SupplierOutcome,

  // Workflow result
  WorkflowResult,

  // API response
  HotelSearchResponse,

  // Errors
  SearchErrorCode,
  SearchError,

  // Cancel
  CancelResponse,

  // Activity I/O
  FetchSupplierInput,
  SupplierHttpResponse,
  ActivityResult,
} from "./types";

// Search execution state
export type {
  SearchState,
  IdleState,
  SearchingState,
  CompletedState,
  FailedState,
  CancelledState,
  SupplierStatusSummary,
} from "./searchState";

export {
  toSupplierSummary,
  deriveWarnings,
  responseToSearchState,
} from "./searchState";
