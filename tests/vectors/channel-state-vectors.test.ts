import { readFileSync } from 'fs';
import { join } from 'path';
import { encodeChannelState, hashChannelState, signChannelState, type ChannelState } from '../packages/settlement/src/state-store';

interface TestVector {
  name: string;
  state: {
    channelId: string;
    contractAddress: string;
    contractVersion: number;
    nonce: number;
    payerBalance: string;
    payeeBalance: string;
    windowStart: number;
    windowEnd: number;
  };
  signingKey: string;
}

interface VectorFile {
  vectors: TestVector[];
}

describe('Cross-language channel-state test vectors (TypeScript suite)', () => {
  const vectorsPath = join(__dirname, 'channel-state-vectors.json');
  const vectorFile = JSON.parse(readFileSync(vectorsPath, 'utf8')) as VectorFile;

  for (const vector of vectorFile.vectors) {
    const state: ChannelState = {
      channelId: vector.state.channelId,
      contractAddress: vector.state.contractAddress,
      contractVersion: vector.state.contractVersion,
      nonce: vector.state.nonce,
      payerBalance: BigInt(vector.state.payerBalance),
      payeeBalance: BigInt(vector.state.payeeBalance),
      windowStart: vector.state.windowStart,
      windowEnd: vector.state.windowEnd,
    };

    test(`vector: ${vector.name} - encodes deterministically`, () => {
      const encoded = encodeChannelState(state);
      const expected = [
        'channel-state',
        state.channelId,
        state.contractAddress.toLowerCase(),
        String(state.contractVersion),
        String(state.nonce),
        state.payerBalance.toString(),
        state.payeeBalance.toString(),
        String(state.windowStart),
        String(state.windowEnd),
      ].join('|');

      expect(encoded).toBe(expected);
    });

    test(`vector: ${vector.name} - hashes and signs successfully`, () => {
      const digest = hashChannelState(state);
      expect(digest).toHaveLength(64); // SHA-256 hex digest

      const signed = signChannelState(state, vector.signingKey);
      expect(signed.signature).toBeDefined();
      expect(typeof signed.signature).toBe('string');
      expect(signed.signature.length).toBeGreaterThan(0);
    });
  }
});
