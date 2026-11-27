import fs from 'fs';
import path from 'path';

import { loadManifestIntoEnv, resolveManifestPath } from '../src/utils/manifest';

describe('manifest loader', () => {
  const network = 'testloader';
  const manifestPath = resolveManifestPath(network);

  beforeAll(() => {
    const base = path.dirname(manifestPath);
    if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ network, sorobanContractAddress: 'CTEST123', sorobanRpcUrl: 'https://rpc.test' }),
    );
  });

  afterAll(() => {
    try {
      fs.unlinkSync(manifestPath);
    } catch {}
  });

  it('populates process.env from manifest when missing', () => {
    delete process.env.SOROBAN_CONTRACT_ADDRESS;
    process.env.STELLAR_NETWORK = network;

    const manifest = loadManifestIntoEnv(network);
    expect(manifest).not.toBeNull();
    expect(process.env.SOROBAN_CONTRACT_ADDRESS).toBe('CTEST123');
  });
});
