import { describe, it, expect } from "vitest";
import {
  validateSubscriptionData,
  validateAPIKey,
  maskAPIKey,
} from "../validation";

describe("validateSubscriptionData", () => {
  it("should pass with valid data", () => {
    const result = validateSubscriptionData({
      name: "Netflix",
      price: "9.99",
      email: "user@example.com",
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("should fail when name is empty", () => {
    const result = validateSubscriptionData({ name: "", price: "9.99" });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe("Subscription name is required");
  });

  it("should fail when name is over 100 characters", () => {
    const result = validateSubscriptionData({
      name: "a".repeat(101),
      price: "9.99",
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe(
      "Subscription name must be less than 100 characters",
    );
  });

  it("should fail when price is zero", () => {
    const result = validateSubscriptionData({ name: "Netflix", price: "0" });
    expect(result.isValid).toBe(false);
    expect(result.errors.price).toBe("Price must be greater than $0");
  });

  it("should fail when price exceeds 10000", () => {
    const result = validateSubscriptionData({
      name: "Netflix",
      price: "10001",
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.price).toBe("Price must be less than $10,000");
  });

  it("should fail when renewsIn is negative", () => {
    const result = validateSubscriptionData({
      name: "Netflix",
      price: "9.99",
      renewsIn: "-1",
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.renewsIn).toBe(
      "Days until renewal must be 0 or greater",
    );
  });

  it("should fail when renewsIn exceeds 365", () => {
    const result = validateSubscriptionData({
      name: "Netflix",
      price: "9.99",
      renewsIn: "366",
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.renewsIn).toBe(
      "Days until renewal must be less than 365",
    );
  });

  it("should fail with invalid email format", () => {
    const result = validateSubscriptionData({
      name: "Netflix",
      price: "9.99",
      email: "not-an-email",
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBe("Invalid email format");
  });
});

describe("validateAPIKey", () => {
  it("should fail when API key is empty", () => {
    const result = validateAPIKey("openai", "");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("API key is required");
  });

  it("should fail for OpenAI key not starting with sk-", () => {
    const result = validateAPIKey("openai", "invalid-key-that-is-long-enough");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("OpenAI API keys must start with 'sk-'");
  });

  it("should pass for valid OpenAI key", () => {
    const result = validateAPIKey(
      "openai",
      "sk-validkeyThatIsLongEnough123456",
    );
    expect(result.isValid).toBe(true);
  });

  it("should fail for Anthropic key not starting with sk-ant-", () => {
    const result = validateAPIKey("anthropic", "sk-wrong-prefix");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Anthropic API keys must start with 'sk-ant-'",
    );
  });

  it("should pass for valid Anthropic key", () => {
    const result = validateAPIKey("anthropic", "sk-ant-validkey123");
    expect(result.isValid).toBe(true);
  });

  it("should fail for short Google API key", () => {
    const result = validateAPIKey("google", "shortkey");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Google API key appears to be too short");
  });

  it("should pass for valid Google API key", () => {
    const result = validateAPIKey("google", "a".repeat(31));
    expect(result.isValid).toBe(true);
  });
});

describe("maskAPIKey", () => {
  it("should mask a normal API key", () => {
    const result = maskAPIKey("sk-ant-validkey123456");
    expect(result).toBe("sk-ant-...3456");
  });

  it("should return dots for short or empty key", () => {
    const result = maskAPIKey("short");
    expect(result).toContain("•");
  });

  it("should return dots for empty string", () => {
    const result = maskAPIKey("");
    expect(result).toContain("•");
  });
});
