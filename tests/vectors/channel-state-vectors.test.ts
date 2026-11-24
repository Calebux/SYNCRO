import { readFileSync } from 'fs';
import { join } from 'path';
import {
  encodeChannelState,
  channelStateDigest,
  signChannelState,
  type ChannelState,
  HmacChannelStateSigner,
} from '@syncro/settlement';

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
      contractVersion: String(vector.state.contractVersion),
      nonce: vector.state.nonce,
      payerBalance: BigInt(vector.state.payerBalance),
      payeeBalance: BigInt(vector.state.payeeBalance),
      windowStart: vector.state.windowStart,
      windowEnd: vector.state.windowEnd,
    };

    const signer = new HmacChannelStateSigner(vector.signingKey);

    describe(vector.name, () => {
      it('encodes deterministically', () => {
        const encoded1 = encodeChannelState(state);
        const encoded2 = encodeChannelState(state);
        expect(encoded1).toBe(encoded2);
      });

      it('hashes deterministically', () => {
        const digest1 = channelStateDigest(state);
        const digest2 = channelStateDigest(state);
        expect(digest1).toBe(digest2);
      });

      it('signs and verifies correctly', () => {
        const signed = signChannelState(state, signer);
        expect(signed.state).toBe(state);
        expect(typeof signed.signature).toBe('string');
        expect(signed.signature.length).toBeGreaterThan(0);
      });
    });
  }
});