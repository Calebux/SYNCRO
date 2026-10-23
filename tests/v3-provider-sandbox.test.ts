import { describe, it, expect } from 'vitest';
import { assertNetworkForMode } from '../backend/src/v3/provider-store';

describe('Issue #1699: staging providers are testnet-only sandbox', () => {
  it('staging providers cannot be called with mainnet credentials', () => {
    expect(() => assertNetworkForMode('staging', 'mainnet')).toThrow(
      /staging_mainnet_forbidden/,
    );
  });

  it('staging providers are admitted on testnet', () => {
    expect(() => assertNetworkForMode('staging', 'testnet')).not.toThrow();
  });

  it('production providers still require the mainnet runtime', () => {
    expect(() => assertNetworkForMode('production', 'testnet')).toThrow(
      /mainnet/,
    );
    expect(() => assertNetworkForMode('production', 'mainnet')).not.toThrow();
  });
});
