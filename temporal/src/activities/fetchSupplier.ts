import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import type {
  ActivityResult,
  FetchSupplierInput,
} from "@hotel-rate-comparator/shared";

/** Per-supplier deadline. Below startToCloseTimeout so we own the failure. */
const HTTP_TIMEOUT_MS = 5_000;

/** Guards against a malformed supplier payload reaching the workflow. */
const supplierResponseSchema = z.object({
  hotels: z.array(
    z.object({
      hotelId: z.string(),
      name: z.string(),
      price: z.number(),
    }),
  ),
});

/**
 * Fetches hotels from one supplier. Cancellation and the timeout abort the
 * same controller, so `timedOut` distinguishes them.
 */
export async function fetchSupplierHotels(
  input: FetchSupplierInput,
): Promise<ActivityResult> {
  const ctx = Context.current();
  const { attempt } = ctx.info;
  const startedAt = Date.now();
  const searchId = (
    ctx.info.workflowExecution?.workflowId ?? "unknown"
  ).replace(/^hotel-search-/, "");

  const controller = new AbortController();
  const onCancel = () => controller.abort();
  ctx.cancellationSignal.addEventListener("abort", onCancel);

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(input, attempt).toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      // 4xx is a contract problem — retrying cannot fix it.
      if (response.status < 500) {
        throw ApplicationFailure.nonRetryable(
          `Supplier ${input.supplier} rejected the request (HTTP ${response.status})`,
          "SUPPLIER_BAD_REQUEST",
        );
      }
      // 5xx may be transient — let the retry policy handle it.
      throw new Error(
        `Supplier ${input.supplier} returned HTTP ${response.status}`,
      );
    }

    const data = supplierResponseSchema.parse(await response.json());
    const durationMs = Date.now() - startedAt;

    console.log(
      JSON.stringify({
        event: "supplier_completed",
        searchId,
        supplier: input.supplier,
        attempt,
        durationMs,
        hotels: data.hotels.length,
      }),
    );

    return {
      supplier: input.supplier,
      hotels: data.hotels,
      attempts: attempt,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    // Non-retryable: retrying a too-slow supplier only adds latency.
    if (timedOut) {
      console.log(
        JSON.stringify({
          event: "supplier_timeout",
          searchId,
          supplier: input.supplier,
          attempt,
          durationMs,
        }),
      );
      throw ApplicationFailure.nonRetryable(
        `Supplier ${input.supplier} did not respond within ${HTTP_TIMEOUT_MS}ms`,
        "SUPPLIER_TIMEOUT",
      );
    }

    console.log(
      JSON.stringify({
        event: "supplier_failed",
        searchId,
        supplier: input.supplier,
        attempt,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    ctx.cancellationSignal.removeEventListener("abort", onCancel);
  }
}

function buildUrl(input: FetchSupplierInput, attempt: number): URL {
  const url = new URL(input.baseUrl);
  url.searchParams.set("city", input.city);
  url.searchParams.set("checkIn", input.checkIn);
  url.searchParams.set("checkOut", input.checkOut);
  url.searchParams.set("attempt", String(attempt));

  if (input.scenario) {
    url.searchParams.set("scenario", input.scenario);
  }

  return url;
}
