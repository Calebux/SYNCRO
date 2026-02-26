import { describe, it, expect } from "@jest/globals";

// Dynamic import is required for ESM compatibility with ts-jest preset
const {
    validateSubscriptionCreateInput,
    validateSubscriptionUpdateInput,
    validateGiftCardHash,
} = await import("./validators.js");

// ─── Helpers ─────────────────────────────────────────────────────────

/** Shorthand: assert a function call throws with a specific message substring. */
function expectThrow(fn: () => unknown, messageSubstring: string) {
    expect(fn).toThrow(messageSubstring);
}

/** A valid SHA-256 hex hash (64 lowercase hex chars). */
const VALID_HASH =
    "a3f1b2c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef";

// ─── validateSubscriptionCreateInput ─────────────────────────────────

describe("validateSubscriptionCreateInput", () => {
    const validPayload = {
        name: "Netflix",
        category: "Streaming",
        price: 15.99,
    };

    // ── Success paths ──────────────────────────────────────────────────

    it("accepts a valid minimal payload and fills defaults", () => {
        const result = validateSubscriptionCreateInput(validPayload);
        expect(result.name).toBe("Netflix");
        expect(result.category).toBe("Streaming");
        expect(result.price).toBe(15.99);
        expect(result.status).toBe("active");
        expect(result.billing_cycle).toBe("monthly");
        expect(result.icon).toBe("🔗");
        expect(result.color).toBe("#000000");
        expect(result.tags).toEqual([]);
        expect(result.pricing_type).toBe("fixed");
        expect(result.is_trial).toBe(false);
    });

    it("accepts a fully populated payload", () => {
        const full = {
            name: "Spotify Premium",
            category: "Music",
            price: 9.99,
            status: "active" as const,
            billing_cycle: "monthly" as const,
            renews_in: 30,
            icon: "🎵",
            color: "#1DB954",
            renewal_url: "https://spotify.com/account",
            tags: ["music", "entertainment"],
            pricing_type: "fixed" as const,
            is_trial: true,
            trial_ends_at: "2026-03-15T00:00:00Z",
            price_after_trial: 12.99,
        };
        const result = validateSubscriptionCreateInput(full);
        expect(result.name).toBe("Spotify Premium");
        expect(result.is_trial).toBe(true);
        expect(result.price_after_trial).toBe(12.99);
    });

    // ── Null / undefined / non-object ──────────────────────────────────

    it("throws when input is null", () => {
        expectThrow(
            () => validateSubscriptionCreateInput(null),
            "non-null object",
        );
    });

    it("throws when input is undefined", () => {
        expectThrow(
            () => validateSubscriptionCreateInput(undefined),
            "non-null object",
        );
    });

    it("throws when input is a string", () => {
        expectThrow(
            () => validateSubscriptionCreateInput("hello"),
            "plain object",
        );
    });

    it("throws when input is an array", () => {
        expectThrow(
            () => validateSubscriptionCreateInput([]),
            "plain object",
        );
    });

    it("throws when input is a number", () => {
        expectThrow(
            () => validateSubscriptionCreateInput(42),
            "plain object",
        );
    });

    // ── Name validation ────────────────────────────────────────────────

    it("throws when name is missing", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({ category: "A", price: 10 }),
            "name",
        );
    });

    it("throws when name is empty string", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "",
                    category: "A",
                    price: 10,
                }),
            "must not be empty",
        );
    });

    it("throws when name exceeds 100 characters", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "x".repeat(101),
                    category: "A",
                    price: 10,
                }),
            "at most 100",
        );
    });

    // ── Category validation ────────────────────────────────────────────

    it("throws when category is missing", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({ name: "Netflix", price: 10 }),
            "category",
        );
    });

    it("throws when category is empty string", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "Netflix",
                    category: "",
                    price: 10,
                }),
            "must not be empty",
        );
    });

    // ── Price validation ───────────────────────────────────────────────

    it("throws when price is missing", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "Netflix",
                    category: "Streaming",
                }),
            "price",
        );
    });

    it("throws when price is zero", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "Netflix",
                    category: "Streaming",
                    price: 0,
                }),
            "greater than 0",
        );
    });

    it("throws when price is negative", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "Netflix",
                    category: "Streaming",
                    price: -5,
                }),
            "greater than 0",
        );
    });

    it("throws when price exceeds $10,000", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "Netflix",
                    category: "Streaming",
                    price: 10_001,
                }),
            "10,000",
        );
    });

    it("throws when price is not a number", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    name: "Netflix",
                    category: "Streaming",
                    price: "free",
                }),
            "Invalid input",
        );
    });

    // ── Status validation ──────────────────────────────────────────────

    it("throws when status is invalid", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    status: "bogus",
                }),
            "Invalid option",
        );
    });

    // ── Billing cycle validation ───────────────────────────────────────

    it("throws when billing_cycle is invalid", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    billing_cycle: "bi-weekly",
                }),
            "Invalid option",
        );
    });

    // ── Color validation ───────────────────────────────────────────────

    it("throws when color is not a valid hex code", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    color: "red",
                }),
            "valid hex code",
        );
    });

    it("throws for hex color with wrong length", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    color: "#FFF",
                }),
            "valid hex code",
        );
    });

    // ── URL validation ─────────────────────────────────────────────────

    it("throws when renewal_url is not a valid URL", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    renewal_url: "not-a-url",
                }),
            "valid URL",
        );
    });

    // ── Tags validation ────────────────────────────────────────────────

    it("throws when tags contains an empty string", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    tags: ["valid", ""],
                }),
            "must not be empty",
        );
    });

    it("throws when tags exceed max count (20)", () => {
        const manyTags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    tags: manyTags,
                }),
            "maximum of 20",
        );
    });

    it("throws when a tag exceeds 50 characters", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    tags: ["x".repeat(51)],
                }),
            "at most 50",
        );
    });

    // ── Renewal days validation ────────────────────────────────────────

    it("throws when renews_in is negative", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    renews_in: -1,
                }),
            "0 or greater",
        );
    });

    it("throws when renews_in exceeds 365", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    renews_in: 366,
                }),
            "365",
        );
    });

    it("throws when renews_in is a float", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    renews_in: 10.5,
                }),
            "whole number",
        );
    });

    // ── Trial fields validation ────────────────────────────────────────

    it("throws when trial_ends_at is not a valid datetime", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    trial_ends_at: "next-tuesday",
                }),
            "ISO 8601",
        );
    });

    it("throws when price_after_trial is zero", () => {
        expectThrow(
            () =>
                validateSubscriptionCreateInput({
                    ...validPayload,
                    price_after_trial: 0,
                }),
            "greater than 0",
        );
    });

    // ── Multiple-error aggregation ─────────────────────────────────────

    it("aggregates multiple errors separated by ' | '", () => {
        try {
            validateSubscriptionCreateInput({});
            throw new Error("Should have thrown");
        } catch (e: any) {
            expect(e.message).toContain("|");
            expect(e.message).toContain("name");
            expect(e.message).toContain("category");
            expect(e.message).toContain("price");
        }
    });
});

// ─── validateSubscriptionUpdateInput ─────────────────────────────────

describe("validateSubscriptionUpdateInput", () => {
    // ── Success paths ──────────────────────────────────────────────────

    it("accepts a single valid field update", () => {
        const result = validateSubscriptionUpdateInput({ price: 19.99 });
        expect(result.price).toBe(19.99);
    });

    it("accepts multiple valid field updates", () => {
        const result = validateSubscriptionUpdateInput({
            name: "Netflix Premium",
            status: "paused",
        });
        expect(result.name).toBe("Netflix Premium");
        expect(result.status).toBe("paused");
    });

    // ── Null / undefined / non-object ──────────────────────────────────

    it("throws when input is null", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput(null),
            "non-null object",
        );
    });

    it("throws when input is undefined", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput(undefined),
            "non-null object",
        );
    });

    it("throws when input is a string", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput("hello"),
            "plain object",
        );
    });

    it("throws when input is an array", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput([]),
            "plain object",
        );
    });

    // ── Empty object ───────────────────────────────────────────────────

    it("throws when input is an empty object", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput({}),
            "At least one field",
        );
    });

    // ── Invalid field values ───────────────────────────────────────────

    it("throws when name is empty string on update", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput({ name: "" }),
            "must not be empty",
        );
    });

    it("throws when price is negative on update", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput({ price: -10 }),
            "greater than 0",
        );
    });

    it("throws when status is invalid on update", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput({ status: "destroyed" }),
            "Invalid option",
        );
    });

    it("throws when color is invalid on update", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput({ color: "purple" }),
            "valid hex code",
        );
    });

    it("throws when renewal_url is invalid on update", () => {
        expectThrow(
            () => validateSubscriptionUpdateInput({ renewal_url: "bad" }),
            "valid URL",
        );
    });
});

// ─── validateGiftCardHash ────────────────────────────────────────────

describe("validateGiftCardHash", () => {
    // ── Success path ───────────────────────────────────────────────────

    it("accepts a valid 64-char lowercase hex hash", () => {
        const result = validateGiftCardHash(VALID_HASH);
        expect(result).toBe(VALID_HASH);
    });

    // ── Null / undefined ───────────────────────────────────────────────

    it("throws when input is null", () => {
        expectThrow(() => validateGiftCardHash(null), "required");
    });

    it("throws when input is undefined", () => {
        expectThrow(() => validateGiftCardHash(undefined), "required");
    });

    // ── Non-string types ───────────────────────────────────────────────

    it("throws when input is a number", () => {
        expectThrow(() => validateGiftCardHash(42), "must be a string");
    });

    it("throws when input is a boolean", () => {
        expectThrow(() => validateGiftCardHash(true), "must be a string");
    });

    it("throws when input is an object", () => {
        expectThrow(() => validateGiftCardHash({}), "must be a string");
    });

    it("throws when input is an array", () => {
        expectThrow(() => validateGiftCardHash([]), "must be a string");
    });

    // ── Empty string ───────────────────────────────────────────────────

    it("throws when input is empty string", () => {
        expectThrow(() => validateGiftCardHash(""), "must not be empty");
    });

    // ── Wrong length ───────────────────────────────────────────────────

    it("throws when hash is too short (63 chars)", () => {
        expectThrow(
            () => validateGiftCardHash(VALID_HASH.slice(0, 63)),
            "exactly 64 characters",
        );
    });

    it("throws when hash is too long (65 chars)", () => {
        expectThrow(
            () => validateGiftCardHash(VALID_HASH + "a"),
            "exactly 64 characters",
        );
    });

    // ── Invalid characters ─────────────────────────────────────────────

    it("throws when hash contains uppercase letters", () => {
        const upper = VALID_HASH.slice(0, 63) + "A";
        expectThrow(
            () => validateGiftCardHash(upper),
            "lowercase hexadecimal",
        );
    });

    it("throws when hash contains non-hex characters", () => {
        const bad = VALID_HASH.slice(0, 63) + "g";
        expectThrow(
            () => validateGiftCardHash(bad),
            "lowercase hexadecimal",
        );
    });

    it("throws when hash contains spaces", () => {
        const spaced = " " + VALID_HASH.slice(1);
        expectThrow(() => validateGiftCardHash(spaced), "lowercase hexadecimal");
    });

    // ── Partial hash ───────────────────────────────────────────────────

    it("throws for a 32-char hex string (MD5 length)", () => {
        expectThrow(
            () => validateGiftCardHash("a".repeat(32)),
            "exactly 64 characters",
        );
    });
});
