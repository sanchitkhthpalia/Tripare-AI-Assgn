import { Connection, Client } from "@temporalio/client";
import type {
  HotelSearchRequest,
  WorkflowResult,
  CancelResponse,
} from "@hotel-rate-comparator/shared";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "hotel-search";

let clientInstance: Client | null = null;

/**
 * Returns a singleton Temporal client, creating and caching the
 * connection on first call.
 */
export async function getTemporalClient(): Promise<Client> {
  if (clientInstance) return clientInstance;

  const connection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });

  clientInstance = new Client({ connection });
  return clientInstance;
}

/**
 * Starts a hotel search workflow and waits for the result.
 *
 * Uses the string workflow name rather than importing the workflow
 * function directly — the workflow file imports @temporalio/workflow
 * which is designed for the sandbox, not for direct Node.js use.
 *
 * The searchId from the request is used as the Temporal workflowId
 * so cancel can target the workflow by searchId.
 */
export async function startHotelSearch(
  request: HotelSearchRequest,
): Promise<WorkflowResult> {
  const client = await getTemporalClient();

  const handle = await client.workflow.start("hotelSearchWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId: `hotel-search-${request.searchId}`,
    args: [request],
    // Prevents a hung request when no worker is running.
    workflowExecutionTimeout: "30s",
  });

  return handle.result() as Promise<WorkflowResult>;
}

/**
 * Sends a cancellation request to a hotel search workflow.
 *
 * Safe in all cases:
 *   - Workflow is still running → cancel signal sent → "cancelled"
 *   - Workflow already completed → NOT_FOUND from Temporal → "already_completed"
 *   - Workflow never existed → NOT_FOUND from Temporal → "not_found"
 *
 * The Temporal gRPC API returns NOT_FOUND for both "completed" and
 * "never existed", so we cannot distinguish between them. However,
 * from the user's perspective, the effect is identical: the search
 * is no longer in progress.
 *
 * We use "already_completed" as the default NOT_FOUND message because
 * it's the more common case (the user searches, it finishes, then they
 * hit cancel). The frontend can treat both the same way.
 */
export async function cancelHotelSearch(
  searchId: string,
): Promise<CancelResponse> {
  const workflowId = `hotel-search-${searchId}`;

  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    await handle.cancel();

    return {
      outcome: "cancelled",
      searchId,
      message: "Cancellation signal sent to the search workflow.",
    };
  } catch (err: unknown) {
    // Temporal returns a gRPC NOT_FOUND when the workflow is already
    // completed or never existed. Both are safe no-ops.
    if (isNotFoundError(err)) {
      return {
        outcome: "already_completed",
        searchId,
        message: "The search has already completed or was not found.",
      };
    }

    // Infrastructure failure, not "not found" — let the route return 503.
    throw err;
  }
}

/**
 * Checks if a Temporal client error is a gRPC NOT_FOUND.
 * Uses duck typing because the SDK doesn't export a dedicated error class.
 */
function isNotFoundError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const obj = err as Record<string, unknown>;

  // ServiceError from @temporalio/client has a `code` property
  if (obj["code"] === 5) return true; // gRPC NOT_FOUND = 5

  // Also check the message as a fallback
  if (
    typeof obj["message"] === "string" &&
    obj["message"].includes("NOT_FOUND")
  ) {
    return true;
  }

  return false;
}
