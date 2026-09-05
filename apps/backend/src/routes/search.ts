import { Router } from "express";
import crypto from "node:crypto";
import type {
  HotelSearchRequest,
  HotelSearchResponse,
} from "@hotel-rate-comparator/shared";
import {
  searchRequestSchema,
  formatValidationErrors,
} from "../middleware/validate";
import { startHotelSearch, cancelHotelSearch } from "../services/temporal";
import {
  mapWorkflowResult,
  mapWorkflowError,
  httpStatusFor,
} from "../services/searchService";

export const searchRouter = Router();

// ── POST /api/search-hotels ─────────────────────────────────────

searchRouter.post("/api/search-hotels", async (req, res) => {
  // 1. Validate
  const parsed = searchRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    const response: HotelSearchResponse = {
      status: "error",
      searchId: "",
      error: {
        code: "VALIDATION_ERROR",
        message: formatValidationErrors(parsed.error).join("; "),
      },
    };
    res.status(400).json(response);
    return;
  }

  // 2. Build request with searchId
  const searchId = parsed.data.searchId ?? crypto.randomUUID();

  const request: HotelSearchRequest = {
    searchId,
    city: parsed.data.city,
    checkIn: parsed.data.checkIn,
    checkOut: parsed.data.checkOut,
    scenarios: parsed.data.scenarios,
  };

  // 3. Call Temporal workflow and map result
  const startTime = Date.now();
  console.log(
    JSON.stringify({ event: "search_started", searchId, city: request.city }),
  );

  try {
    const result = await startHotelSearch(request);
    const durationMs = Date.now() - startTime;
    const response = mapWorkflowResult(searchId, result, durationMs);
    console.log(
      JSON.stringify({
        event: "workflow_completed",
        searchId,
        durationMs,
        status: response.status,
      }),
    );
    res.status(httpStatusFor(response)).json(response);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const response = mapWorkflowError(searchId, err);
    console.log(
      JSON.stringify({
        event: "workflow_failed",
        searchId,
        durationMs,
        status: response.status,
      }),
    );
    res.status(httpStatusFor(response)).json(response);
  }
});

// ── POST /api/search-hotels/:searchId/cancel ────────────────────

searchRouter.post("/api/search-hotels/:searchId/cancel", async (req, res) => {
  const { searchId } = req.params;

  console.log(JSON.stringify({ event: "search_cancel_requested", searchId }));

  // Express 4 does not forward async rejections to error middleware.
  try {
    const result = await cancelHotelSearch(searchId);

    console.log(
      JSON.stringify({
        event: "workflow_cancelled",
        searchId,
        outcome: result.outcome,
      }),
    );

    // Always 200 — cancellation is a safe operation regardless of outcome.
    // The `outcome` field tells the frontend what actually happened.
    res.json(result);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "cancel_failed",
        searchId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    res.status(503).json({
      outcome: "not_found",
      searchId,
      message: "Unable to reach the workflow service to cancel this search.",
    });
  }
});
