import { z } from "zod";

// ── Date helpers ────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that a YYYY-MM-DD string is a real calendar date.
 * "2024-02-30" matches the regex but is not a valid date.
 */
function isValidCalendarDate(str: string): boolean {
  const date = new Date(`${str}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().startsWith(str);
}

// ── Schema ──────────────────────────────────────────────────────

export const searchRequestSchema = z
  .object({
    city: z
      .string({ required_error: "City is required" })
      .trim()
      .min(1, "City is required"),

    checkIn: z
      .string({ required_error: "Check-in date is required" })
      .regex(ISO_DATE, "Check-in must be a valid date (YYYY-MM-DD)")
      .refine(isValidCalendarDate, "Check-in is not a valid calendar date"),

    checkOut: z
      .string({ required_error: "Check-out date is required" })
      .regex(ISO_DATE, "Check-out must be a valid date (YYYY-MM-DD)")
      .refine(isValidCalendarDate, "Check-out is not a valid calendar date"),

    // Becomes the Temporal workflowId, so it must be constrained.
    searchId: z.string().uuid("searchId must be a UUID").optional(),

    scenarios: z
      .object({
        supplierA: z
          .enum(["normal", "slow", "empty", "error", "retry"])
          .optional(),
        supplierB: z
          .enum(["normal", "slow", "empty", "error", "retry"])
          .optional(),
      })
      .optional(),
  })
  .strict()
  .refine((data) => data.checkOut > data.checkIn, {
    message: "Check-out date must be after check-in date",
    path: ["checkOut"],
  });

export type ValidatedSearchRequest = z.infer<typeof searchRequestSchema>;

/**
 * Formats Zod validation errors into a flat, readable array.
 */
export function formatValidationErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
