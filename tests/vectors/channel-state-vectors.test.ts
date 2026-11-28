import { readFileSync } from 'fs';
import { join } from 'path';
import {
  encodeChannelState,
  channelStateDigest,
  signChannelState,
  type ChannelState,
  HmacChannelStateSigner,
} from '@syncro/settlement';

// ── JSON schema mirrors (must stay in sync with channel-state-vectors.json) ──

interface VectorStateRaw {
  channelId: string;
  contractAddress: string;
  contractVersion: number;
  nonce: number;
  payerBalance: string;
  payeeBalance: string;
  windowStart: number;
  windowEnd: number;
}

interface TestVector {
  name: string;
  state: VectorStateRaw;
  signingKey: string;
  /**
   * The canonical pipe-delimited encoding produced by encodeChannelState().
   * Both the TypeScript and Rust suites must produce exactly this string.
   */
  expectedEncoding: string;
  /**
   * SHA-256 of the canonical encoding, hex-encoded.
   * Produced by channelStateDigest().
   */
  expectedDigest: string;
  /**
   * HMAC-SHA-256(signingKey, canonicalEncoding), hex-encoded.
   * Produced by signChannelState().
   */
  expectedSignature: string;
}

interface VectorFile {
  vectors: TestVector[];
}

// ── Load vectors ──────────────────────────────────────────────────────────────

const vectorsPath = join(__dirname, 'channel-state-vectors.json');
const vectorFile = JSON.parse(readFileSync(vectorsPath, 'utf8')) as VectorFile;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(raw: VectorStateRaw): ChannelState {
  return {
    channelId: raw.channelId,
    contractAddress: raw.contractAddress,
    // contractVersion is a number in JSON but a string in ChannelState so the
    // Rust contract representation (string) is preserved on the wire.
    contractVersion: String(raw.contractVersion),
    nonce: raw.nonce,
    payerBalance: BigInt(raw.payerBalance),
    payeeBalance: BigInt(raw.payeeBalance),
    windowStart: raw.windowStart,
    windowEnd: raw.windowEnd,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Cross-language channel-state test vectors (TypeScript suite)', () => {
  if (vectorFile.vectors.length === 0) {
    throw new Error('No vectors loaded from channel-state-vectors.json — file is empty');
  }

  for (const vector of vectorFile.vectors) {
    const state = makeState(vector.state);
    const signer = new HmacChannelStateSigner(vector.signingKey);

    describe(vector.name, () => {
      // ── Determinism ────────────────────────────────────────────────────────

      it('encodes deterministically', () => {
        expect(encodeChannelState(state)).toBe(encodeChannelState(state));
      });

      it('hashes deterministically', () => {
        expect(channelStateDigest(state)).toBe(channelStateDigest(state));
      });

      // ── Cross-language byte-for-byte checks ────────────────────────────────
      //
      // These assertions are the main acceptance criterion for issue #1814:
      //   "Rust output matches the TypeScript output byte for byte on the shared vectors."
      //
      // The Rust side of these same checks lives in:
      //   contracts/crates/channel-state/tests/vectors.rs :: cross_language_vectors_pass

      it('produces the expected canonical encoding', () => {
        expect(encodeChannelState(state)).toBe(vector.expectedEncoding);
      });

      it('produces the expected SHA-256 digest', () => {
        expect(channelStateDigest(state)).toBe(vector.expectedDigest);
      });

      it('produces the expected HMAC-SHA-256 signature', () => {
        const signed = signChannelState(state, signer);
        expect(signed.signature).toBe(vector.expectedSignature);
      });

      // ── Structural checks ──────────────────────────────────────────────────

      it('signChannelState returns the same state object', () => {
        const signed = signChannelState(state, signer);
        expect(signed.state).toBe(state);
      });

      it('signature is a 64-character lowercase hex string', () => {
        const signed = signChannelState(state, signer);
        expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
      });
    });
  }
});
