import { describe, it, expect } from "vitest";
import {
  resolveScenario,
  parseScenario,
  parseAttempt,
  NORMAL_DELAY_MS,
  SLOW_DELAY_MS,
  RETRY_FAIL_UNTIL_ATTEMPT,
} from "../../apps/backend/src/suppliers/scenarios";

const SAMPLE_HOTELS = [
  { hotelId: "h1", name: "Test Hotel", price: 100 },
  { hotelId: "h2", name: "Other Hotel", price: 200 },
];

describe("resolveScenario", () => {
  // ---------------------------------------------------------------
  // normal
  // ---------------------------------------------------------------

  it("normal: returns 200 with hotels and a short delay", () => {
    const result = resolveScenario("normal", SAMPLE_HOTELS, 1);
    expect(result.statusCode).toBe(200);
    expect(result.hotels).toEqual(SAMPLE_HOTELS);
    expect(result.delayMs).toBe(NORMAL_DELAY_MS);
  });

  // ---------------------------------------------------------------
  // slow
  // ---------------------------------------------------------------

  it("slow: returns 200 with hotels but a delay exceeding 5s", () => {
    const result = resolveScenario("slow", SAMPLE_HOTELS, 1);
    expect(result.statusCode).toBe(200);
    expect(result.hotels).toEqual(SAMPLE_HOTELS);
    expect(result.delayMs).toBe(SLOW_DELAY_MS);
    expect(result.delayMs).toBeGreaterThan(5000);
  });

  // ---------------------------------------------------------------
  // empty
  // ---------------------------------------------------------------

  it("empty: returns 200 with an empty hotels array", () => {
    const result = resolveScenario("empty", SAMPLE_HOTELS, 1);
    expect(result.statusCode).toBe(200);
    expect(result.hotels).toEqual([]);
    expect(result.delayMs).toBe(NORMAL_DELAY_MS);
  });

  // ---------------------------------------------------------------
  // error
  // ---------------------------------------------------------------

  it("error: returns 500 with no hotels and no delay", () => {
    const result = resolveScenario("error", SAMPLE_HOTELS, 1);
    expect(result.statusCode).toBe(500);
    expect(result.hotels).toEqual([]);
    expect(result.delayMs).toBe(0);
  });

  // ---------------------------------------------------------------
  // retry
  // ---------------------------------------------------------------

  it("retry: fails on attempt 1", () => {
    const result = resolveScenario("retry", SAMPLE_HOTELS, 1);
    expect(result.statusCode).toBe(500);
    expect(result.hotels).toEqual([]);
  });

  it("retry: fails on attempt 2", () => {
    const result = resolveScenario("retry", SAMPLE_HOTELS, 2);
    expect(result.statusCode).toBe(500);
    expect(result.hotels).toEqual([]);
  });

  it("retry: succeeds on the configured attempt threshold", () => {
    const result = resolveScenario(
      "retry",
      SAMPLE_HOTELS,
      RETRY_FAIL_UNTIL_ATTEMPT,
    );
    expect(result.statusCode).toBe(200);
    expect(result.hotels).toEqual(SAMPLE_HOTELS);
  });

  it("retry: succeeds on attempts beyond the threshold", () => {
    const result = resolveScenario(
      "retry",
      SAMPLE_HOTELS,
      RETRY_FAIL_UNTIL_ATTEMPT + 1,
    );
    expect(result.statusCode).toBe(200);
    expect(result.hotels).toEqual(SAMPLE_HOTELS);
  });

  // ---------------------------------------------------------------
  // The slow scenario delay is testable without waiting
  // ---------------------------------------------------------------

  it("slow delay exceeds Temporal 5s timeout without actually waiting", () => {
    // This test verifies the CONFIGURED delay value, not an actual timer.
    // The resolveScenario function returns a data object; the Express
    // handler is the one that calls setTimeout. So this test runs in <1ms.
    const result = resolveScenario("slow", SAMPLE_HOTELS, 1);
    expect(result.delayMs).toBeGreaterThan(5000);
    expect(result.statusCode).toBe(200); // it would succeed — if it got through
  });
});

// -------------------------------------------------------------------
// parseScenario
// -------------------------------------------------------------------

describe("parseScenario", () => {
  it("parses valid scenario strings", () => {
    expect(parseScenario("normal")).toBe("normal");
    expect(parseScenario("slow")).toBe("slow");
    expect(parseScenario("empty")).toBe("empty");
    expect(parseScenario("error")).toBe("error");
    expect(parseScenario("retry")).toBe("retry");
  });

  it("defaults to normal for unknown strings", () => {
    expect(parseScenario("invalid")).toBe("normal");
    expect(parseScenario("NORMAL")).toBe("normal");
    expect(parseScenario("")).toBe("normal");
  });

  it("defaults to normal for non-string values", () => {
    expect(parseScenario(undefined)).toBe("normal");
    expect(parseScenario(null)).toBe("normal");
    expect(parseScenario(42)).toBe("normal");
  });
});

// -------------------------------------------------------------------
// parseAttempt
// -------------------------------------------------------------------

describe("parseAttempt", () => {
  it("parses valid attempt strings", () => {
    expect(parseAttempt("1")).toBe(1);
    expect(parseAttempt("3")).toBe(3);
    expect(parseAttempt("10")).toBe(10);
  });

  it("defaults to 1 for invalid values", () => {
    expect(parseAttempt("0")).toBe(1);
    expect(parseAttempt("-1")).toBe(1);
    expect(parseAttempt("abc")).toBe(1);
    expect(parseAttempt(undefined)).toBe(1);
    expect(parseAttempt(null)).toBe(1);
  });
});
