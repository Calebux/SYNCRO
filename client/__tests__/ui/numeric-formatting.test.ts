import { describe, it, expect } from "vitest";
import {
  formatSettlementAmount,
  formatStroopsAsXlm,
  formatBaseUnits,
  formatBalance,
  formatCompactNumber,
  formatNonce,
  formatRate,
  formatDelta,
  formatPercentDelta,
  toNumber,
  toBigInt,
  isValidNumber,
  isBigInt,
  SETTLEMENT_ASSET,
  STELLAR_NATIVE,
} from "@syncro/ui";

describe("numeric-formatting", () => {
  describe("formatSettlementAmount", () => {
    it("formats USDC amounts with 6 decimal places", () => {
      expect(formatSettlementAmount(1_000_000)).toBe("1.000000 USDC");
      expect(formatSettlementAmount(1_234_567)).toBe("1.234567 USDC");
      expect(formatSettlementAmount(0)).toBe("0.000000 USDC");
    });

    it("handles bigint values", () => {
      expect(formatSettlementAmount(BigInt(1_000_000))).toBe("1.000000 USDC");
    });

    it("can hide symbol", () => {
      expect(formatSettlementAmount(1_000_000, { showSymbol: false })).toBe("1.000000");
    });

    it("uses locale for formatting", () => {
      const de = formatSettlementAmount(1_234_567, { locale: "de-DE" });
      expect(de).toContain("1,234567");
    });
  });

  describe("formatStroopsAsXlm", () => {
    it("converts stroops to XLM with 7 decimal places", () => {
      expect(formatStroopsAsXlm(10_000_000)).toBe("1.0000000 XLM");
      expect(formatStroopsAsXlm(50_000_000)).toBe("5.0000000 XLM");
      expect(formatStroopsAsXlm(1_500_000)).toBe("0.1500000 XLM");
    });

    it("handles bigint values", () => {
      expect(formatStroopsAsXlm(BigInt(10_000_000))).toBe("1.0000000 XLM");
    });

    it("never renders raw stroops as float", () => {
      // 10_000_000 stroops = 1 XLM, NOT 10000000.00
      const formatted = formatStroopsAsXlm(10_000_000);
      expect(formatted).not.toContain("10000000");
      expect(formatted).toBe("1.0000000 XLM");
    });
  });

  describe("formatBaseUnits", () => {
    it("formats with custom asset config", () => {
      const customAsset = { code: "TEST", symbol: "TEST", decimals: 3, baseUnit: 1000 };
      expect(formatBaseUnits(1500, customAsset)).toBe("1.500 TEST");
      expect(formatBaseUnits(1000, customAsset)).toBe("1.000 TEST");
    });
  });

  describe("formatBalance", () => {
    it("formats balance with asset", () => {
      expect(formatBalance(1_234_567)).toBe("1.234567 USDC");
      expect(formatBalance(0, SETTLEMENT_ASSET, { blankZero: true })).toBe("—");
    });

    it("handles blankZero option", () => {
      expect(formatBalance(0, SETTLEMENT_ASSET, { blankZero: true })).toBe("—");
      expect(formatBalance(0, SETTLEMENT_ASSET, { blankZero: false })).toBe("0.000000 USDC");
    });
  });

  describe("formatCompactNumber", () => {
    it("formats numbers in compact notation", () => {
      expect(formatCompactNumber(999)).toBe("999");
      expect(formatCompactNumber(1_234)).toBe("1.2K");
      expect(formatCompactNumber(1_234_567)).toBe("1.2M");
      expect(formatCompactNumber(1_234_567_890)).toBe("1.2B");
    });

    it("respects precision option", () => {
      expect(formatCompactNumber(1_234_567, { precision: 2 })).toBe("1.23M");
    });
  });

  describe("formatNonce", () => {
    it("formats nonce without grouping or decimals", () => {
      expect(formatNonce(0)).toBe("0");
      expect(formatNonce(1)).toBe("1");
      expect(formatNonce(12345)).toBe("12345");
      expect(formatNonce(999999999)).toBe("999999999");
    });

    it("handles bigint", () => {
      expect(formatNonce(BigInt(12345))).toBe("12345");
    });
  });

  describe("formatRate", () => {
    it("formats rate with unit", () => {
      expect(formatRate(123.4567, "calls/sec")).toBe("123.4567 calls/sec");
      expect(formatRate(0.000045, "USDC/call", { precision: 6 })).toBe("0.000045 USDC/call");
    });
  });

  describe("formatDelta", () => {
    it("formats positive delta with + sign", () => {
      const result = formatDelta(150);
      expect(result.formatted).toBe("+150.00");
      expect(result.isPositive).toBe(true);
      expect(result.isNegative).toBe(false);
      expect(result.isZero).toBe(false);
    });

    it("formats negative delta with − sign", () => {
      const result = formatDelta(-75);
      expect(result.formatted).toBe("−75.00");
      expect(result.isPositive).toBe(false);
      expect(result.isNegative).toBe(true);
      expect(result.isZero).toBe(false);
    });

    it("formats zero delta", () => {
      const result = formatDelta(0);
      expect(result.formatted).toBe("0.00");
      expect(result.isPositive).toBe(false);
      expect(result.isNegative).toBe(false);
      expect(result.isZero).toBe(true);
    });

    it("formats monetary delta with asset", () => {
      const result = formatDelta(1_234_567, {
        asset: SETTLEMENT_ASSET,
      });
      expect(result.formatted).toBe("+1.234567 USDC");
    });

    it("can hide plus sign", () => {
      const result = formatDelta(150, { showPlusSign: false });
      expect(result.formatted).toBe("150.00");
    });
  });

  describe("formatPercentDelta", () => {
    it("formats percentage delta", () => {
      const result = formatPercentDelta(5.2);
      expect(result.formatted).toBe("+5.2%");
      expect(result.isPositive).toBe(true);
    });

    it("formats negative percentage", () => {
      const result = formatPercentDelta(-3.1);
      expect(result.formatted).toBe("−3.1%");
      expect(result.isNegative).toBe(true);
    });
  });

  describe("toNumber", () => {
    it("converts number", () => {
      expect(toNumber(42)).toBe(42);
    });

    it("converts bigint", () => {
      expect(toNumber(BigInt(42))).toBe(42);
    });

    it("converts string", () => {
      expect(toNumber("42")).toBe(42);
    });

    it("returns NaN for invalid", () => {
      expect(toNumber("abc")).toBeNaN();
      expect(toNumber(null)).toBeNaN();
      expect(toNumber(undefined)).toBeNaN();
    });
  });

  describe("toBigInt", () => {
    it("converts number", () => {
      expect(toBigInt(42)).toBe(BigInt(42));
    });

    it("converts bigint", () => {
      expect(toBigInt(BigInt(42))).toBe(BigInt(42));
    });

    it("converts string", () => {
      expect(toBigInt("42")).toBe(BigInt(42));
    });

    it("returns 0n for invalid", () => {
      expect(toBigInt("abc")).toBe(BigInt(0));
      expect(toBigInt(null)).toBe(BigInt(0));
      expect(toBigInt(undefined)).toBe(BigInt(0));
    });
  });

  describe("isValidNumber", () => {
    it("returns true for valid numbers", () => {
      expect(isValidNumber(42)).toBe(true);
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(-1)).toBe(true);
      expect(isValidNumber(3.14)).toBe(true);
    });

    it("returns false for invalid", () => {
      expect(isValidNumber(NaN)).toBe(false);
      expect(isValidNumber(Infinity)).toBe(false);
      expect(isValidNumber(-Infinity)).toBe(false);
      expect(isValidNumber("42")).toBe(false);
      expect(isValidNumber(null)).toBe(false);
    });
  });

  describe("isBigInt", () => {
    it("returns true for bigint", () => {
      expect(isBigInt(BigInt(42))).toBe(true);
      expect(isBigInt(0n)).toBe(true);
    });

    it("returns false for non-bigint", () => {
      expect(isBigInt(42)).toBe(false);
      expect(isBigInt("42")).toBe(false);
      expect(isBigInt(null)).toBe(false);
    });
  });

  describe("constants", () => {
    it("exports SETTLEMENT_ASSET", () => {
      expect(SETTLEMENT_ASSET.code).toBe("USDC");
      expect(SETTLEMENT_ASSET.decimals).toBe(6);
      expect(SETTLEMENT_ASSET.baseUnit).toBe(1_000_000);
    });

    it("exports STELLAR_NATIVE", () => {
      expect(STELLAR_NATIVE.code).toBe("XLM");
      expect(STELLAR_NATIVE.decimals).toBe(7);
      expect(STELLAR_NATIVE.stroopsPerXlm).toBe(10_000_000);
    });
  });
});