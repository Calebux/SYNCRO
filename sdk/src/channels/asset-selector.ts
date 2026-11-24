/**
 * Multi-asset channel selection for the consumer SDK (issue #1807).
 *
 * Providers may price in USDC, EURC, XLM, or any other Stellar asset.
 * A consumer typically holds open channels for a subset of those assets.
 * This module picks the best matching channel and fails with a typed
 * `NoCompatibleChannelError` when none matches, so the caller can surface
 * a clear message rather than receiving a silent payment failure.
 *
 * ## Asset identity
 *
 * Assets are compared case-insensitively by their canonical code:
 *   - "USDC", "usdc"              → match
 *   - "USDC:issuer-A", "USDC"     → match (code extracted, issuer ignored unless strict)
 *   - "native", "XLM"             → match (Stellar native asset alias)
 *
 * Full `CODE:ISSUER` identity checking is opt-in via
 * {@link AssetSelectorOptions.strictIssuer}.
 *
 * ## Preference order
 *
 * When more than one of the consumer's channels matches a provider-accepted
 * asset, the channel for the asset that appears earliest in
 * {@link AssetSelectorOptions.preferredAssets} is chosen. If no preference
 * list is supplied the first matching channel in the order they were provided
 * is returned.
 *
 * ## Sources of accepted assets
 *
 * Two wire formats are supported:
 *
 * 1. **HTTP 402 / x402 challenge** (`X402Challenge`) — the `accepts` array
 *    already used by `createPaidFetch`. Each entry carries an `asset` field.
 *
 * 2. **Provider manifest** (`ProviderManifest`) — an off-chain JSON document
 *    listing `acceptedAssets` as an array of asset codes or `CODE:ISSUER`
 *    strings.
 *
 * Both shapes are normalised by {@link readAcceptedAssets} before selection.
 */

import { SyncroError } from "../errors.js";

// ─── Asset types ─────────────────────────────────────────────────────────────

/**
 * Minimal representation of an asset.
 * `code` is always upper-cased; `issuer` is present only for non-native assets.
 */
export interface AssetId {
  /** Upper-cased asset code, e.g. "USDC", "EURC", "XLM". */
  code: string;
  /** Issuer account address. Absent for the Stellar native asset (XLM). */
  issuer?: string;
}

/** Parse `"CODE"` or `"CODE:ISSUER"` into an {@link AssetId}. */
export function parseAssetId(raw: string): AssetId {
  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) {
    // "native" is the Stellar canonical spelling for XLM
    const code = trimmed.toUpperCase() === "NATIVE" ? "XLM" : trimmed.toUpperCase();
    return { code };
  }
  const code = trimmed.slice(0, colonIdx).toUpperCase() === "NATIVE"
    ? "XLM"
    : trimmed.slice(0, colonIdx).toUpperCase();
  const issuer = trimmed.slice(colonIdx + 1).trim();
  return { code, issuer: issuer.length > 0 ? issuer : undefined };
}

/**
 * Returns true when `a` and `b` refer to the same asset.
 *
 * When `strictIssuer` is false (default) only the code is compared; this
 * handles the common case where the consumer stores assets by code and the
 * provider challenge includes a full `CODE:ISSUER` string.
 *
 * When `strictIssuer` is true both code and issuer must match. Assets that
 * carry no issuer (XLM) always match on code alone regardless of this flag.
 */
export function assetMatches(a: AssetId, b: AssetId, strictIssuer = false): boolean {
  if (a.code !== b.code) return false;
  if (!strictIssuer) return true;
  // Native asset (XLM) has no issuer by definition — always a code-only match
  if (a.code === "XLM") return true;
  // In strict mode both sides must carry an issuer, and they must be equal.
  // If either side is missing an issuer the match is ambiguous — treat as no-match.
  if (a.issuer === undefined || b.issuer === undefined) return false;
  return a.issuer === b.issuer;
}

// ─── Wire formats ─────────────────────────────────────────────────────────────

/**
 * One entry from the `accepts` array of an x402 / HTTP 402 challenge.
 * Only `asset` is required for selection; additional fields are carried
 * through for the caller's use.
 */
export interface X402Requirement {
  /** Asset code or "CODE:ISSUER" string, e.g. "USDC" or "USDC:GA5ZSEJ...". */
  asset: string;
  scheme?: string;
  network?: string;
  amount?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  [key: string]: unknown;
}

/**
 * A minimal x402 challenge as emitted by `createPaidFetch` and the provider
 * middleware. Only the `accepts` array is used for asset selection.
 */
export interface X402Challenge {
  x402Version?: number;
  accepts?: X402Requirement[];
  [key: string]: unknown;
}

/**
 * An off-chain provider manifest that describes which assets the provider
 * accepts. Fields beyond `acceptedAssets` are ignored by this module.
 */
export interface ProviderManifest {
  /**
   * List of asset codes or "CODE:ISSUER" strings the provider accepts.
   * @example ["USDC", "EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP"]
   */
  acceptedAssets: string[];
  [key: string]: unknown;
}

/**
 * Normalise either a provider manifest or an x402 challenge into a plain
 * list of `AssetId` values that the selector can work with.
 *
 * Returns an empty array when neither recognised shape is present so the
 * caller gets a `NoCompatibleChannelError` with an empty accepted-asset list
 * rather than a runtime exception.
 */
export function readAcceptedAssets(source: X402Challenge | ProviderManifest): AssetId[] {
  // ProviderManifest
  if ("acceptedAssets" in source && Array.isArray(source.acceptedAssets)) {
    return source.acceptedAssets.map(parseAssetId);
  }
  // X402Challenge
  if ("accepts" in source && Array.isArray(source.accepts)) {
    return (source.accepts as X402Requirement[])
      .filter((r) => typeof r.asset === "string" && r.asset.length > 0)
      .map((r) => parseAssetId(r.asset));
  }
  return [];
}

// ─── Channel descriptor ───────────────────────────────────────────────────────

/**
 * Minimal description of a consumer-side channel.
 * The `asset` field identifies which token the channel is funded in.
 * All other fields are passed through unchanged so callers can store
 * whatever extra data they need (channelId, contractId, balance, …).
 */
export interface ChannelDescriptor<T = unknown> {
  /**
   * The asset this channel is funded in.
   * Accepts a code string ("USDC"), a "CODE:ISSUER" string, or an
   * already-parsed {@link AssetId}.
   */
  asset: string | AssetId;
  /** Caller-defined payload — anything from a bigint channel ID to a full ChannelView. */
  channel: T;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown by {@link selectChannelForAsset} when no open channel matches any
 * of the assets the provider accepts.
 *
 * The `acceptedAssets` and `availableAssets` fields let the caller emit a
 * precise error message or take a remediation action (e.g. open a new
 * channel in the required asset).
 */
export class NoCompatibleChannelError extends SyncroError {
  /**
   * Assets the provider declared it accepts (from the challenge or manifest).
   * May be empty if the provider sent no asset information.
   */
  readonly acceptedAssets: AssetId[];
  /**
   * Assets for which the consumer has an open channel.
   * May be empty if the consumer passed no channels.
   */
  readonly availableAssets: AssetId[];

  constructor(acceptedAssets: AssetId[], availableAssets: AssetId[]) {
    const accepted = acceptedAssets.map((a) => formatAsset(a)).join(", ") || "(none)";
    const available = availableAssets.map((a) => formatAsset(a)).join(", ") || "(none)";
    super(
      `No open channel matches the provider's accepted assets. ` +
        `Provider accepts: ${accepted}. ` +
        `Consumer has channels for: ${available}.`,
      { code: "NO_COMPATIBLE_CHANNEL", retryable: false },
    );
    this.acceptedAssets = acceptedAssets;
    this.availableAssets = availableAssets;
  }
}

function formatAsset(a: AssetId): string {
  return a.issuer ? `${a.code}:${a.issuer}` : a.code;
}

// ─── Selector ─────────────────────────────────────────────────────────────────

export interface AssetSelectorOptions {
  /**
   * Preference order for assets when multiple channels match.
   * Assets listed earlier are preferred. Each entry may be a code string
   * ("USDC") or a "CODE:ISSUER" string.
   *
   * When omitted the first matching channel in the order the `channels`
   * array was provided is returned.
   */
  preferredAssets?: string[];
  /**
   * When true, both the asset code **and** the issuer address must match.
   * Defaults to false (code-only matching).
   */
  strictIssuer?: boolean;
}

/**
 * Select the best channel from `channels` for the assets declared by
 * `source` (an x402 challenge or provider manifest).
 *
 * @param source    The 402 challenge or provider manifest to read accepted assets from.
 * @param channels  The consumer's available channels, each tagged with an asset.
 * @param options   Optional preference order and strict-issuer flag.
 *
 * @returns The `channel` payload from the matching {@link ChannelDescriptor}.
 *
 * @throws {NoCompatibleChannelError} when no channel matches any accepted asset.
 *
 * @example
 * ```ts
 * const channel = selectChannelForAsset(
 *   { x402Version: 2, accepts: [{ asset: "USDC", ... }] },
 *   [
 *     { asset: "USDC", channel: usdcChannelClient },
 *     { asset: "XLM",  channel: xlmChannelClient  },
 *   ],
 * );
 * // channel === usdcChannelClient
 * ```
 */
export function selectChannelForAsset<T>(
  source: X402Challenge | ProviderManifest,
  channels: ReadonlyArray<ChannelDescriptor<T>>,
  options: AssetSelectorOptions = {},
): T {
  const strictIssuer = options.strictIssuer ?? false;

  // Parse the provider's accepted assets
  const acceptedAssets = readAcceptedAssets(source);

  // Parse all consumer channel assets once
  const parsedChannels = channels.map((descriptor) => ({
    descriptor,
    assetId:
      typeof descriptor.asset === "string"
        ? parseAssetId(descriptor.asset)
        : descriptor.asset,
  }));

  const availableAssets = parsedChannels.map((c) => c.assetId);

  if (acceptedAssets.length === 0 || parsedChannels.length === 0) {
    throw new NoCompatibleChannelError(acceptedAssets, availableAssets);
  }

  // Build a preference-ordered list of accepted assets to try
  const preferenceOrder: AssetId[] =
    options.preferredAssets !== undefined && options.preferredAssets.length > 0
      ? buildPreferenceOrder(options.preferredAssets, acceptedAssets, strictIssuer)
      : acceptedAssets;

  // Try each accepted asset in preference order; return the first channel match
  for (const wanted of preferenceOrder) {
    const match = parsedChannels.find((c) =>
      assetMatches(c.assetId, wanted, strictIssuer),
    );
    if (match) return match.descriptor.channel;
  }

  throw new NoCompatibleChannelError(acceptedAssets, availableAssets);
}

/**
 * Reorder `acceptedAssets` so entries that appear in `preferredOrder` come
 * first (in preference order), with any remaining accepted assets appended.
 */
function buildPreferenceOrder(
  preferredOrder: string[],
  acceptedAssets: AssetId[],
  strictIssuer: boolean,
): AssetId[] {
  const preferred = preferredOrder.map(parseAssetId);
  const result: AssetId[] = [];
  const used = new Set<number>();

  for (const pref of preferred) {
    for (let i = 0; i < acceptedAssets.length; i++) {
      if (!used.has(i) && assetMatches(acceptedAssets[i]!, pref, strictIssuer)) {
        result.push(acceptedAssets[i]!);
        used.add(i);
      }
    }
  }

  // Append any accepted assets not covered by the preference list
  for (let i = 0; i < acceptedAssets.length; i++) {
    if (!used.has(i)) result.push(acceptedAssets[i]!);
  }

  return result;
}
