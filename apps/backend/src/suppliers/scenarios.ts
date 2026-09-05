import type { SupplierScenario } from "@hotel-rate-comparator/shared";

/**
 * The resolved behavior for a mock supplier request.
 *
 * This is a data object — it describes *what* the handler should do,
 * not *how*. The Express handler reads these fields and applies delays,
 * status codes, etc. This keeps the decision logic pure and testable
 * without timers.
 */
export interface ScenarioResolution {
  /** HTTP status code to return. */
  statusCode: number;
  /** Milliseconds to wait before responding. */
  delayMs: number;
  /** Hotel data to include in the response body (empty on error/empty). */
  hotels: Array<{ hotelId: string; name: string; price: number }>;
  /** Human-readable label for logging. */
  label: string;
}

/** Normal response delay band (deterministic, not random). */
const NORMAL_DELAY_MS = 300;

/**
 * Exceeds the 5 s Temporal activity `startToCloseTimeout` so the activity
 * will be cancelled/timed out before this response arrives.
 */
const SLOW_DELAY_MS = 6_000;

/**
 * How many attempts the `retry` scenario fails before succeeding.
 * Matches the default retry policy of maximumAttempts=3.
 */
const RETRY_FAIL_UNTIL_ATTEMPT = 3;

/**
 * Pure function that resolves a scenario + attempt number into a
 * concrete response plan.
 *
 * @param scenario  - Which simulation mode to run.
 * @param hotels    - The hotels this supplier would normally return.
 * @param attempt   - The Temporal activity attempt number (1-indexed).
 *                    Forwarded by the activity via query param so the
 *                    `retry` scenario can fail deterministically on
 *                    early attempts.
 */
export function resolveScenario(
  scenario: SupplierScenario,
  hotels: Array<{ hotelId: string; name: string; price: number }>,
  attempt: number,
): ScenarioResolution {
  switch (scenario) {
    case "normal":
      return {
        statusCode: 200,
        delayMs: NORMAL_DELAY_MS,
        hotels,
        label: "normal",
      };

    case "slow":
      return {
        statusCode: 200,
        delayMs: SLOW_DELAY_MS,
        hotels,
        label: `slow (${SLOW_DELAY_MS}ms delay)`,
      };

    case "empty":
      return {
        statusCode: 200,
        delayMs: NORMAL_DELAY_MS,
        hotels: [],
        label: "empty",
      };

    case "error":
      return {
        statusCode: 500,
        delayMs: 0,
        hotels: [],
        label: "error (500)",
      };

    case "retry":
      if (attempt < RETRY_FAIL_UNTIL_ATTEMPT) {
        return {
          statusCode: 500,
          delayMs: 0,
          hotels: [],
          label: `retry: failing (attempt ${attempt} of ${RETRY_FAIL_UNTIL_ATTEMPT})`,
        };
      }
      return {
        statusCode: 200,
        delayMs: NORMAL_DELAY_MS,
        hotels,
        label: `retry: succeeding (attempt ${attempt})`,
      };

    default: {
      // Exhaustiveness check — if a new scenario is added to the union
      // and not handled here, TypeScript will error on this line.
      const _exhaustive: never = scenario;
      return _exhaustive;
    }
  }
}

/**
 * Parses a raw query param into a valid SupplierScenario.
 * Unknown values fall back to 'normal'.
 */
const VALID_SCENARIOS: ReadonlySet<string> = new Set<SupplierScenario>([
  "normal",
  "slow",
  "empty",
  "error",
  "retry",
]);

export function parseScenario(raw: unknown): SupplierScenario {
  if (typeof raw === "string" && VALID_SCENARIOS.has(raw)) {
    return raw as SupplierScenario;
  }
  return "normal";
}

/**
 * Parses the attempt query param. Defaults to 1 if missing or invalid.
 */
export function parseAttempt(raw: unknown): number {
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) {
      return n;
    }
  }
  return 1;
}

// Exported for tests
export { NORMAL_DELAY_MS, SLOW_DELAY_MS, RETRY_FAIL_UNTIL_ATTEMPT };
