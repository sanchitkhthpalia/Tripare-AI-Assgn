import { useState, useRef, useCallback } from "react";
import type {
  HotelSearchResponse,
  SearchState,
  SupplierScenario,
} from "@hotel-rate-comparator/shared";
import { responseToSearchState } from "@hotel-rate-comparator/shared";

export interface SearchParams {
  city: string;
  checkIn: string;
  checkOut: string;
  scenarios?: {
    supplierA?: SupplierScenario;
    supplierB?: SupplierScenario;
  };
}

export interface UseHotelSearch {
  state: SearchState;
  search: (params: SearchParams) => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Manages the hotel search lifecycle.
 *
 * State transitions:
 *   idle → searching → completed | failed | cancelled
 *
 * Cancellation is two-pronged:
 *   1. Abort the in-flight HTTP request (immediate UI response)
 *   2. POST to /api/search-hotels/:searchId/cancel (tells Temporal to stop)
 */
/** Backend caps a search at 30s; past 35s the response itself is lost. */
const REQUEST_TIMEOUT_MS = 35_000;

/** randomUUID is undefined outside a secure context (plain-HTTP LAN). */
function newSearchId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function useHotelSearch(): UseHotelSearch {
  const [state, setState] = useState<SearchState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const searchIdRef = useRef<string | null>(null);

  const search = useCallback((params: SearchParams) => {
    const searchId = newSearchId();
    searchIdRef.current = searchId;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Stops the UI spinning forever if the request never resolves.
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    let timedOut = false;
    const timeoutWatcher = window.setTimeout(() => {
      timedOut = true;
    }, REQUEST_TIMEOUT_MS);

    setState({
      phase: "searching",
      searchId,
      message: "Querying suppliers\u2026",
    });

    fetch("/api/search-hotels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        city: params.city,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        searchId,
        scenarios: params.scenarios,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        // A proxy error page returns HTML, not JSON.
        let data: HotelSearchResponse;
        try {
          data = (await res.json()) as HotelSearchResponse;
        } catch {
          throw new Error(
            `The search service returned an unreadable response (HTTP ${res.status}).`,
          );
        }
        setState(responseToSearchState(data));
      })
      .catch((err) => {
        // User cancelled via cancel() — state already updated
        if (err instanceof DOMException && err.name === "AbortError") {
          if (!timedOut) return;
          setState({
            phase: "failed",
            searchId,
            error: {
              code: "INTERNAL_ERROR",
              message:
                "The search timed out before the service responded. Please try again.",
            },
            suppliers: null,
          });
          return;
        }

        setState({
          phase: "failed",
          searchId,
          error: {
            code: "INTERNAL_ERROR",
            message:
              err instanceof Error && err.message
                ? err.message
                : "Unable to connect to the search service. Is the backend running?",
          },
          suppliers: null,
        });
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        window.clearTimeout(timeoutWatcher);
      });
  }, []);

  const cancel = useCallback(() => {
    const searchId = searchIdRef.current;
    if (!searchId) return;

    // 1. Abort the in-flight HTTP request (immediate UI response)
    abortRef.current?.abort();

    // 2. Tell the backend to cancel the Temporal workflow (best-effort)
    fetch(`/api/search-hotels/${searchId}/cancel`, { method: "POST" }).catch(
      () => {
        /* best effort */
      },
    );

    setState({ phase: "cancelled", searchId });
  }, []);

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    searchIdRef.current = null;
  }, []);

  return { state, search, cancel, reset };
}
