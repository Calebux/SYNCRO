/**
 * Client-Side Validation Utilities
 *
 * Zod-based validators that run BEFORE any API request from the client layer,
 * ensuring invalid payloads never reach the backend. These complement the
 * existing `validateSubscriptionData` form-level validation in `validation.ts`
 * and provide stricter, schema-based validation at the service boundary.
 */

import { z } from "zod";

// ─── Constants ───────────────────────────────────────────────────────

const VALID_STATUSES = ["active", "paused", "cancelled", "expired", "expiring"] as const;

const VALID_BILLING_CYCLES = [
    "monthly",
    "quarterly",
    "semi-annual",
    "annual",
    "lifetime",
] as const;

const VALID_PRICING_TYPES = ["fixed", "usage", "tiered"] as const;

const MAX_NAME_LENGTH = 100;
const MAX_PRICE = 10_000;
const MAX_RENEWS_IN_DAYS = 365;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const GIFT_CARD_HASH_REGEX = /^[0-9a-f]{64}$/;

// ─── Zod Schemas ─────────────────────────────────────────────────────

export const SubscriptionCreateSchema = z.object({
    name: z
        .string({ required_error: "Subscription name is required." })
        .min(1, "Subscription name must not be empty.")
        .max(MAX_NAME_LENGTH, `Subscription name must be at most ${MAX_NAME_LENGTH} characters.`),

    category: z
        .string({ required_error: "Category is required." })
        .min(1, "Category must not be empty."),

    price: z
        .number({
            required_error: "Price is required.",
            invalid_type_error: "Price must be a number.",
        })
        .positive("Price must be greater than 0.")
        .max(MAX_PRICE, `Price must not exceed $${MAX_PRICE.toLocaleString()}.`),

    status: z.enum(VALID_STATUSES).optional().default("active"),

    billing_cycle: z.enum(VALID_BILLING_CYCLES).optional().default("monthly"),

    renews_in: z
        .number()
        .int("Renewal days must be a whole number.")
        .min(0, "Renewal days must be 0 or greater.")
        .max(MAX_RENEWS_IN_DAYS, `Renewal days must not exceed ${MAX_RENEWS_IN_DAYS}.`)
        .nullable()
        .optional(),

    // Also accept camelCase from client forms
    renewsIn: z
        .number()
        .int("Renewal days must be a whole number.")
        .min(0, "Renewal days must be 0 or greater.")
        .max(MAX_RENEWS_IN_DAYS, `Renewal days must not exceed ${MAX_RENEWS_IN_DAYS}.`)
        .optional(),

    icon: z.string().optional().default("🔗"),

    color: z
        .string()
        .regex(HEX_COLOR_REGEX, "Color must be a valid hex code (e.g. #FF5733).")
        .optional()
        .default("#000000"),

    renewal_url: z.string().url("Renewal URL must be a valid URL.").nullable().optional(),
    renewalUrl: z.string().url("Renewal URL must be a valid URL.").nullable().optional(),

    tags: z
        .array(
            z.string().min(1, "Tag must not be empty.").max(MAX_TAG_LENGTH, `Tag must be at most ${MAX_TAG_LENGTH} characters.`)
        )
        .max(MAX_TAGS, `A maximum of ${MAX_TAGS} tags is allowed.`)
        .optional()
        .default([]),

    pricing_type: z.enum(VALID_PRICING_TYPES).optional().default("fixed"),
    pricingType: z.enum(VALID_PRICING_TYPES).optional(),

    is_trial: z.boolean().optional().default(false),
    isTrial: z.boolean().optional(),

    trial_ends_at: z.string().datetime("trial_ends_at must be a valid ISO 8601 datetime.").nullable().optional(),
    trialEndsAt: z.string().datetime("trialEndsAt must be a valid ISO 8601 datetime.").nullable().optional(),

    price_after_trial: z
        .number()
        .positive("Price after trial must be greater than 0.")
        .max(MAX_PRICE, `Price after trial must not exceed $${MAX_PRICE.toLocaleString()}.`)
        .nullable()
        .optional(),
    priceAfterTrial: z
        .number()
        .positive("Price after trial must be greater than 0.")
        .nullable()
        .optional(),

    userId: z.string().optional(),
    billingCycle: z.enum(VALID_BILLING_CYCLES).optional(),
}).passthrough(); // Allow additional fields to pass through for flexibility

export const SubscriptionUpdateSchema = SubscriptionCreateSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field must be provided for update." }
);

export const GiftCardHashSchema = z
    .string({
        required_error: "Gift card hash is required.",
        invalid_type_error: "Gift card hash must be a string.",
    })
    .min(1, "Gift card hash must not be empty.")
    .length(64, "Gift card hash must be exactly 64 characters (SHA-256).")
    .regex(GIFT_CARD_HASH_REGEX, "Gift card hash must be a lowercase hexadecimal string.");

// ─── Public Validation Functions ─────────────────────────────────────

/**
 * Validate subscription creation payload before network call.
 * @throws {Error} with descriptive message listing all validation failures.
 */
export function validateSubscriptionCreateInput(input: unknown): z.infer<typeof SubscriptionCreateSchema> {
    if (input === null || input === undefined) {
        throw new Error("Validation failed: Subscription create payload must be a non-null object.");
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Validation failed: Subscription create payload must be a plain object.");
    }

    const result = SubscriptionCreateSchema.safeParse(input);
    if (!result.success) {
        const messages = result.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`
        );
        throw new Error(`Validation failed: ${messages.join(" | ")}`);
    }
    return result.data;
}

/**
 * Validate subscription update payload before network call.
 * @throws {Error} with descriptive message listing all validation failures.
 */
export function validateSubscriptionUpdateInput(input: unknown): z.infer<typeof SubscriptionUpdateSchema> {
    if (input === null || input === undefined) {
        throw new Error("Validation failed: Subscription update payload must be a non-null object.");
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Validation failed: Subscription update payload must be a plain object.");
    }
    if (Object.keys(input as object).length === 0) {
        throw new Error("Validation failed: At least one field must be provided for update.");
    }

    const result = SubscriptionUpdateSchema.safeParse(input);
    if (!result.success) {
        const messages = result.error.issues.map(
            (issue) => issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message
        );
        throw new Error(`Validation failed: ${messages.join(" | ")}`);
    }
    return result.data;
}

/**
 * Validate a gift card hash (SHA-256 hex digest) before network call.
 * @throws {Error} with descriptive message if validation fails.
 */
export function validateGiftCardHash(input: unknown): string {
    if (input === null || input === undefined) {
        throw new Error("Validation failed: Gift card hash is required.");
    }
    if (typeof input !== "string") {
        throw new Error("Validation failed: Gift card hash must be a string.");
    }

    const result = GiftCardHashSchema.safeParse(input);
    if (!result.success) {
        const messages = result.error.issues.map((issue) => issue.message);
        throw new Error(`Validation failed: ${messages.join(" | ")}`);
    }
    return result.data;
}
