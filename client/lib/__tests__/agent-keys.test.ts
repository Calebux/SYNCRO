import { describe, expect, it } from 'vitest';
import { identifyKey } from '../agent-keys';
import { encodePublicKey, encodeSecretSeed } from '../stellar-strkey';
import { publicKeyFromSeed } from '../ed25519-public';

const KNOWN_SEED = Uint8Array.from({ length: 32 }, () => 7);

describe('agent key handling', () => {
  it('encodes the known Stellar test key and derives its public identity locally', async () => {
    expect(encodeSecretSeed(KNOWN_SEED)).toBe('SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X');
    expect(encodePublicKey(await publicKeyFromSeed(KNOWN_SEED))).toBe(
      'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
    );
    const secret = 'SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X';
    const imported = await identifyKey(secret);
    expect(imported.publicKey).toBe('GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57');
    expect(imported.secretKey).toBe(secret);
  });
});
