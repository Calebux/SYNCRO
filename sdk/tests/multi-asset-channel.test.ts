/**
 * Tests for multi-asset channel selection (issue #1807).
 *
 * Acceptance criterion: a test with a USDC provider and an XLM provider
 * uses the correct channel for each.
 *
 * Additional coverage:
 *  - Asset parsing (code-only, CODE:ISSUER, native/XLM alias, case)
 *  - Matching with and without strict-issuer mode
 *  - Preference ordering when multiple channels match
 *  - NoCompatibleChannelError lists the right assets
 *  - readAcceptedAssets handles both X402Challenge and ProviderManifest
 *  - Edge cases: empty channels, empty accepted-assets, provider sends no info
 */

import { describe, it, expect } from "@jest/globals";
import {
  selectChannelForAsset,
  readAcceptedAssets,
  parseAssetId,
  assetMatches,
  NoCompatibleChannelError,
  type ChannelDescriptor,
  type X402Challenge,
  type ProviderManifest,
} from "../src/channels/asset-selector.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal channel stand-in — just a name so tests can assert identity. */
interface StubChannel {
  name: string;
}

function ch(asset: string, name: string): ChannelDescriptor<StubChannel> {
  return { asset, channel: { name } };
}

function x402(...assets: string[]): X402Challenge {
  return {
    x402Version: 2,
    accepts: assets.map((asset) => ({ asset, scheme: "exact", amount: "1" })),
  };
}

function manifest(...assets: string[]): ProviderManifest {
  return { acceptedAssets: assets };
}

// ─── parseAssetId ─────────────────────────────────────────────────────────────

describe("parseAssetId", () => {
  it("parses a bare code", () => {
    expect(parseAssetId("USDC")).toEqual({ code: "USDC" });
  });

  it("upper-cases the code", () => {
    expect(parseAssetId("usdc")).toEqual({ code: "USDC" });
    expect(parseAssetId("eUrC")).toEqual({ code: "EURC" });
  });

  it("parses CODE:ISSUER", () => {
    const id = parseAssetId("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    expect(id.code).toBe("USDC");
    expect(id.issuer).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  });

  it("maps 'native' to 'XLM'", () => {
    expect(parseAssetId("native")).toEqual({ code: "XLM" });
    expect(parseAssetId("NATIVE")).toEqual({ code: "XLM" });
    expect(parseAssetId("native:")).toEqual({ code: "XLM" });
  });

  it("maps 'XLM' to 'XLM' unchanged", () => {
    expect(parseAssetId("XLM")).toEqual({ code: "XLM" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseAssetId("  USDC  ")).toEqual({ code: "USDC" });
  });
});

// ─── assetMatches ─────────────────────────────────────────────────────────────

describe("assetMatches", () => {
  it("matches same code, no issuer", () => {
    expect(assetMatches({ code: "USDC" }, { code: "USDC" })).toBe(true);
  });

  it("does not match different codes", () => {
    expect(assetMatches({ code: "USDC" }, { code: "EURC" })).toBe(false);
  });

  it("matches code-only vs CODE:ISSUER in non-strict mode", () => {
    expect(
      assetMatches(
        { code: "USDC" },
        { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
      ),
    ).toBe(true);
  });

  it("matches two full CODE:ISSUER with same issuer in strict mode", () => {
    const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    expect(
      assetMatches({ code: "USDC", issuer }, { code: "USDC", issuer }, true),
    ).toBe(true);
  });

  it("does not match different issuers in strict mode", () => {
    expect(
      assetMatches(
        { code: "USDC", issuer: "GISSUER_A" },
        { code: "USDC", issuer: "GISSUER_B" },
        true,
      ),
    ).toBe(false);
  });

  it("matches XLM code-only vs XLM code-only in strict mode (no issuer for native)", () => {
    expect(assetMatches({ code: "XLM" }, { code: "XLM" }, true)).toBe(true);
  });
});

// ─── readAcceptedAssets ───────────────────────────────────────────────────────

describe("readAcceptedAssets", () => {
  it("reads assets from an X402Challenge", () => {
    const assets = readAcceptedAssets(x402("USDC", "EURC"));
    expect(assets).toHaveLength(2);
    expect(assets[0]).toEqual({ code: "USDC" });
    expect(assets[1]).toEqual({ code: "EURC" });
  });

  it("reads assets from a ProviderManifest", () => {
    const assets = readAcceptedAssets(manifest("USDC", "XLM"));
    expect(assets).toHaveLength(2);
    expect(assets[0]).toEqual({ code: "USDC" });
    expect(assets[1]).toEqual({ code: "XLM" });
  });

  it("skips X402 entries without an asset field", () => {
    const challenge: X402Challenge = {
      x402Version: 2,
      accepts: [
        { asset: "USDC", scheme: "exact" },
        { asset: "", scheme: "exact" },     // empty — skipped
        { scheme: "exact" } as any,          // missing — skipped
      ],
    };
    const assets = readAcceptedAssets(challenge);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toEqual({ code: "USDC" });
  });

  it("returns an empty array when neither shape is present", () => {
    expect(readAcceptedAssets({} as any)).toEqual([]);
  });

  it("returns an empty array when accepts is empty", () => {
    expect(readAcceptedAssets({ x402Version: 2, accepts: [] })).toEqual([]);
  });

  it("parses CODE:ISSUER strings from a manifest", () => {
    const issuer = "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP";
    const assets = readAcceptedAssets(manifest(`USDC:${issuer}`));
    expect(assets[0]).toEqual({ code: "USDC", issuer });
  });
});

// ─── selectChannelForAsset — acceptance criterion ────────────────────────────

describe("selectChannelForAsset — USDC provider / XLM provider", () => {
  const consumerChannels = [
    ch("USDC", "usdc-channel"),
    ch("XLM",  "xlm-channel"),
  ];

  it("selects the USDC channel for a USDC provider (x402 challenge)", () => {
    const channel = selectChannelForAsset(x402("USDC"), consumerChannels);
    expect(channel.name).toBe("usdc-channel");
  });

  it("selects the XLM channel for an XLM provider (x402 challenge)", () => {
    const channel = selectChannelForAsset(x402("XLM"), consumerChannels);
    expect(channel.name).toBe("xlm-channel");
  });

  it("selects the USDC channel for a USDC provider (manifest)", () => {
    const channel = selectChannelForAsset(manifest("USDC"), consumerChannels);
    expect(channel.name).toBe("usdc-channel");
  });

  it("selects the XLM channel for an XLM provider (manifest)", () => {
    const channel = selectChannelForAsset(manifest("XLM"), consumerChannels);
    expect(channel.name).toBe("xlm-channel");
  });

  it("'native' in the provider challenge matches the XLM channel", () => {
    const channel = selectChannelForAsset(x402("native"), consumerChannels);
    expect(channel.name).toBe("xlm-channel");
  });

  it("case-insensitive: 'usdc' challenge matches USDC channel", () => {
    const channel = selectChannelForAsset(x402("usdc"), consumerChannels);
    expect(channel.name).toBe("usdc-channel");
  });
});

// ─── selectChannelForAsset — CODE:ISSUER in challenge ────────────────────────

describe("selectChannelForAsset — CODE:ISSUER in provider challenge", () => {
  const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const consumerChannels = [
    ch("USDC", "usdc-channel"),
    ch("EURC", "eurc-channel"),
  ];

  it("matches USDC channel when provider sends USDC:issuer (non-strict mode)", () => {
    const channel = selectChannelForAsset(x402(`USDC:${issuer}`), consumerChannels);
    expect(channel.name).toBe("usdc-channel");
  });

  it("matches when consumer also stores full CODE:ISSUER", () => {
    const channels = [
      ch(`USDC:${issuer}`, "usdc-with-issuer"),
      ch("EURC", "eurc-channel"),
    ];
    const channel = selectChannelForAsset(x402(`USDC:${issuer}`), channels);
    expect(channel.name).toBe("usdc-with-issuer");
  });

  it("strict mode: rejects when consumer has code-only channel and provider sends full issuer", () => {
    expect(() =>
      selectChannelForAsset(x402(`USDC:${issuer}`), consumerChannels, { strictIssuer: true }),
    ).toThrow(NoCompatibleChannelError);
  });

  it("strict mode: matches when both sides carry the same issuer", () => {
    const channels = [ch(`USDC:${issuer}`, "usdc-strict")];
    const channel = selectChannelForAsset(
      x402(`USDC:${issuer}`),
      channels,
      { strictIssuer: true },
    );
    expect(channel.name).toBe("usdc-strict");
  });
});

// ─── selectChannelForAsset — preference order ────────────────────────────────

describe("selectChannelForAsset — preference order", () => {
  it("picks the preferred asset when multiple channels match", () => {
    // Provider accepts both USDC and EURC; consumer has both.
    const channels = [
      ch("USDC", "usdc-channel"),
      ch("EURC", "eurc-channel"),
    ];
    // Prefer EURC
    const channel = selectChannelForAsset(
      x402("USDC", "EURC"),
      channels,
      { preferredAssets: ["EURC", "USDC"] },
    );
    expect(channel.name).toBe("eurc-channel");
  });

  it("falls back to the next preferred asset when first choice has no channel", () => {
    // Consumer has no EURC channel
    const channels = [ch("USDC", "usdc-channel")];
    const channel = selectChannelForAsset(
      x402("EURC", "USDC"),
      channels,
      { preferredAssets: ["EURC", "USDC"] },
    );
    expect(channel.name).toBe("usdc-channel");
  });

  it("without preference list picks the first accepted asset that has a channel", () => {
    const channels = [
      ch("XLM",  "xlm-channel"),
      ch("USDC", "usdc-channel"),
    ];
    // Provider accepts USDC first, but consumer provided XLM-channel first — 
    // without preference list it iterates accepted assets in order
    const channel = selectChannelForAsset(x402("USDC", "XLM"), channels);
    expect(channel.name).toBe("usdc-channel");
  });
});

// ─── NoCompatibleChannelError ─────────────────────────────────────────────────

describe("NoCompatibleChannelError", () => {
  it("is thrown when no channel matches", () => {
    expect(() =>
      selectChannelForAsset(x402("EURC"), [ch("USDC", "usdc"), ch("XLM", "xlm")]),
    ).toThrow(NoCompatibleChannelError);
  });

  it("lists provider's accepted assets in the error", () => {
    try {
      selectChannelForAsset(x402("EURC"), [ch("USDC", "usdc")]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NoCompatibleChannelError);
      const e = err as NoCompatibleChannelError;
      expect(e.acceptedAssets).toEqual([{ code: "EURC" }]);
    }
  });

  it("lists consumer's available assets in the error", () => {
    try {
      selectChannelForAsset(x402("EURC"), [ch("USDC", "usdc"), ch("XLM", "xlm")]);
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as NoCompatibleChannelError;
      expect(e.availableAssets.map((a) => a.code)).toEqual(["USDC", "XLM"]);
    }
  });

  it("includes both sides in the error message", () => {
    try {
      selectChannelForAsset(x402("EURC"), [ch("USDC", "usdc")]);
    } catch (err) {
      const e = err as NoCompatibleChannelError;
      expect(e.message).toContain("EURC");
      expect(e.message).toContain("USDC");
    }
  });

  it("has code NO_COMPATIBLE_CHANNEL and retryable=false", () => {
    try {
      selectChannelForAsset(x402("EURC"), [ch("USDC", "usdc")]);
    } catch (err) {
      const e = err as NoCompatibleChannelError;
      expect(e.code).toBe("NO_COMPATIBLE_CHANNEL");
      expect(e.retryable).toBe(false);
    }
  });

  it("is thrown when the provider sends no asset information", () => {
    expect(() =>
      selectChannelForAsset({} as any, [ch("USDC", "usdc")]),
    ).toThrow(NoCompatibleChannelError);
  });

  it("is thrown when the consumer has no channels", () => {
    expect(() =>
      selectChannelForAsset(x402("USDC"), []),
    ).toThrow(NoCompatibleChannelError);
  });

  it("includes empty lists when no channels are available", () => {
    try {
      selectChannelForAsset(x402("USDC"), []);
    } catch (err) {
      const e = err as NoCompatibleChannelError;
      expect(e.acceptedAssets).toEqual([{ code: "USDC" }]);
      expect(e.availableAssets).toEqual([]);
    }
  });
});

// ─── Generic channel payload passthrough ─────────────────────────────────────

describe("selectChannelForAsset — typed channel payload", () => {
  it("returns the exact channel object provided", () => {
    const channelObj = { id: 42n, contractId: "CCONTRACT" };
    const result = selectChannelForAsset(
      x402("USDC"),
      [{ asset: "USDC", channel: channelObj }],
    );
    expect(result).toBe(channelObj);
  });

  it("works with pre-parsed AssetId in the descriptor", () => {
    const channel = selectChannelForAsset(
      x402("USDC"),
      [{ asset: { code: "USDC" }, channel: { name: "usdc" } }],
    );
    expect(channel.name).toBe("usdc");
  });
});
