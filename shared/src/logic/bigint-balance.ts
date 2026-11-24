/**
 * @syncro/shared/logic/bigint-balance
 *
 * Safe serialization helpers for bigint balances across API and storage
 * boundaries.
 *
 * JSON.stringify throws on bigint, and Number() silently loses precision
 * above 2^53. These helpers encode amounts as decimal strings so that
 * every boundary (HTTP, database, logs, events) uses one agreed format.
 *
 * Internal code keeps balances as bigint; only at the boundary do we
 * convert to/from strings.
 */

/**
 * Encode a bigint balance as a decimal string.
 *
 * Use this at every boundary where a balance leaves the internal
 * bigint representation: HTTP responses, database writes, log entries,
 * and event payloads.
 */
export function encodeBalance(balance: bigint): string {
  return balance.toString();
}

/**
 * Decode a decimal string back to a bigint balance.
 *
 * Use this when a balance arrives from an external boundary (HTTP
 * request body, database read, log replay, event consumption).
 */
export function decodeBalance(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new RangeError(`Invalid balance string: ${value}`);
  }
  return BigInt(value);
}

/**
 * Encode a set of channel balances as a plain object with string values.
 *
 * Use this when serializing a ChannelState or MeterWindow for an API
 * response or event payload.
 */
export function encodeBalances(payerBalance: bigint, payeeBalance: bigint): {
  payerBalance: string;
  payeeBalance: string;
} {
  return {
    payerBalance: encodeBalance(payerBalance),
    payeeBalance: encodeBalance(payeeBalance),
  };
}

/**
 * Decode a plain object with string balance values back to bigint.
 *
 * Use this when deserializing a ChannelState or MeterWindow from an
 * external boundary.
 */
export function decodeBalances(
  encoded: { payerBalance: string; payeeBalance: string },
): { payerBalance: bigint; payeeBalance: bigint } {
  return {
    payerBalance: decodeBalance(encoded.payerBalance),
    payeeBalance: decodeBalance(encoded.payeeBalance),
  };
}
