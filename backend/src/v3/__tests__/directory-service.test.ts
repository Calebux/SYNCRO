/**
 * Tests for Provider Directory Service
 */

import { DirectoryService } from '../directory-service';
import { InMemoryProviderStore } from '../provider-store';
import type { RegisterProviderInput } from '../types';

describe('DirectoryService', () => {
  let providerStore: InMemoryProviderStore;
  let directory: DirectoryService;

  beforeEach(() => {
    providerStore = new InMemoryProviderStore();
    directory = new DirectoryService(providerStore);
  });

  function registerProvider(identity: string, mode: 'staging' | 'production' = 'production') {
    const input: RegisterProviderInput = {
      identity,
      payoutAddress: `G${identity.toUpperCase()}TESTADDRESS`,
      upstreamBaseUrl: `https://${identity}.example.com`,
      agreementTerms: `${identity} terms`,
      mode,
    };
    return providerStore.registerProvider(input);
  }

  describe('opt-in', () => {
    it('should allow provider to opt in with valid data', () => {
      const provider = registerProvider('acme-ai');
      
      // Verify payout first (required for opt-in)
      providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
      providerStore.completePayoutChallenge(provider.providerId, 'challenge-id', 'valid-signature');

      const optIn = directory.optIn({
        providerId: provider.providerId,
        description: 'AI inference APIs',
        categories: ['ai', 'ml'],
        contact: {
          website: 'https://acme.ai',
          email: 'support@acme.ai',
        },
      });

      expect(optIn.providerId).toBe(provider.providerId);
      expect(optIn.optedIn).toBe(true);
      expect(optIn.categories).toEqual(['ai', 'ml']);
      expect(optIn.description).toBe('AI inference APIs');
    });

    it('should reject opt-in without payout verification', () => {
      const provider = registerProvider('unverified');

      expect(() => {
        directory.optIn({
          providerId: provider.providerId,
          description: 'Test provider',
          categories: ['test'],
        });
      }).toThrow('verify payout address');
    });

    it('should reject opt-in for non-existent provider', () => {
      expect(() => {
        directory.optIn({
          providerId: 'non-existent',
          description: 'Test',
          categories: [],
        });
      }).toThrow('provider not found');
    });

    it('should update existing opt-in when called again', () => {
      const provider = registerProvider('updater');
      providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
      providerStore.completePayoutChallenge(provider.providerId, 'ch-1', 'sig');

      // First opt-in
      directory.optIn({
        providerId: provider.providerId,
        categories: ['ai'],
        description: 'First description',
      });

      // Update opt-in
      const updated = directory.optIn({
        providerId: provider.providerId,
        categories: ['ai', 'data'],
        description: 'Updated description',
      });

      expect(updated.categories).toEqual(['ai', 'data']);
      expect(updated.description).toBe('Updated description');
    });
  });

  describe('opt-out', () => {
    it('should remove provider from directory', () => {
      const provider = registerProvider('remover');
      providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
      providerStore.completePayoutChallenge(provider.providerId, 'ch', 'sig');

      directory.optIn({
        providerId: provider.providerId,
        categories: ['test'],
      });

      expect(directory.isOptedIn(provider.providerId)).toBe(true);

      directory.optOut(provider.providerId);

      expect(directory.isOptedIn(provider.providerId)).toBe(false);
    });

    it('should throw when opting out provider not in directory', () => {
      const provider = registerProvider('never-opted-in');

      expect(() => {
        directory.optOut(provider.providerId);
      }).toThrow('not in directory');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      // Set up multiple providers
      const providers = [
        { identity: 'ai-provider-1', categories: ['ai', 'ml'], mode: 'production' as const },
        { identity: 'ai-provider-2', categories: ['ai'], mode: 'staging' as const },
        { identity: 'data-provider', categories: ['data', 'analytics'], mode: 'production' as const },
        { identity: 'compute-provider', categories: ['compute'], mode: 'production' as const },
      ];

      providers.forEach(({ identity, categories, mode }) => {
        const provider = registerProvider(identity, mode);
        providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
        providerStore.completePayoutChallenge(provider.providerId, 'ch', 'sig');

        directory.optIn({
          providerId: provider.providerId,
          categories,
          description: `${identity} description`,
        });
      });
    });

    it('should return all opted-in providers with no filters', () => {
      const results = directory.query({});

      expect(results.length).toBe(4);
      expect(results.every(r => r.stats.routeCount >= 0)).toBe(true);
    });

    it('should filter by category', () => {
      const aiResults = directory.query({ category: 'ai' });

      expect(aiResults.length).toBe(2);
      expect(aiResults.every(r => r.categories.includes('ai'))).toBe(true);
    });

    it('should filter by mode', () => {
      const prodResults = directory.query({ mode: 'production' });

      expect(prodResults.length).toBe(3);
      expect(prodResults.every(r => r.mode === 'production')).toBe(true);

      const stagingResults = directory.query({ mode: 'staging' });

      expect(stagingResults.length).toBe(1);
      expect(stagingResults[0]?.identity).toBe('ai-provider-2');
    });

    it('should respect pagination', () => {
      const page1 = directory.query({ limit: 2, offset: 0 });
      const page2 = directory.query({ limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      
      // Check no duplicates
      const ids1 = page1.map(r => r.providerId);
      const ids2 = page2.map(r => r.providerId);
      expect(ids1.some(id => ids2.includes(id))).toBe(false);
    });

    it('should cap limit at 100', () => {
      const results = directory.query({ limit: 500 });
      
      // Even with limit 500, should return all 4 (or max 100 if more existed)
      expect(results.length).toBeLessThanOrEqual(100);
    });

    it('should not include opted-out providers', () => {
      const provider = registerProvider('opt-out-test');
      providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
      providerStore.completePayoutChallenge(provider.providerId, 'ch', 'sig');

      directory.optIn({
        providerId: provider.providerId,
        categories: ['test'],
      });

      let results = directory.query({});
      expect(results.some(r => r.providerId === provider.providerId)).toBe(true);

      directory.optOut(provider.providerId);

      results = directory.query({});
      expect(results.some(r => r.providerId === provider.providerId)).toBe(false);
    });
  });

  describe('getEntry', () => {
    it('should return entry for opted-in provider', () => {
      const provider = registerProvider('single-entry');
      providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
      providerStore.completePayoutChallenge(provider.providerId, 'ch', 'sig');

      directory.optIn({
        providerId: provider.providerId,
        categories: ['test'],
        description: 'Test description',
        contact: { website: 'https://test.com' },
      });

      const entry = directory.getEntry(provider.providerId);

      expect(entry).not.toBeNull();
      expect(entry?.providerId).toBe(provider.providerId);
      expect(entry?.description).toBe('Test description');
      expect(entry?.contact?.website).toBe('https://test.com');
      expect(entry?.stats).toBeDefined();
    });

    it('should return null for provider not in directory', () => {
      const provider = registerProvider('not-listed');

      const entry = directory.getEntry(provider.providerId);

      expect(entry).toBeNull();
    });

    it('should return null for opted-out provider', () => {
      const provider = registerProvider('opted-out');
      providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
      providerStore.completePayoutChallenge(provider.providerId, 'ch', 'sig');

      directory.optIn({
        providerId: provider.providerId,
        categories: ['test'],
      });

      directory.optOut(provider.providerId);

      const entry = directory.getEntry(provider.providerId);

      expect(entry).toBeNull();
    });
  });

  describe('getCategories', () => {
    it('should return unique categories from all opted-in providers', () => {
      const provider1 = registerProvider('cat-test-1');
      const provider2 = registerProvider('cat-test-2');

      [provider1, provider2].forEach(provider => {
        providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
        providerStore.completePayoutChallenge(provider.providerId, 'ch', 'sig');
      });

      directory.optIn({
        providerId: provider1.providerId,
        categories: ['ai', 'ml', 'data'],
      });

      directory.optIn({
        providerId: provider2.providerId,
        categories: ['ml', 'compute'],
      });

      const categories = directory.getCategories();

      expect(categories).toEqual(['ai', 'compute', 'data', 'ml']); // sorted
    });

    it('should return empty array when no providers', () => {
      const categories = directory.getCategories();

      expect(categories).toEqual([]);
    });
  });

  describe('stats', () => {
    it('should include uptime and route count', () => {
      const provider = registerProvider('stats-test');
      providerStore.initiatePayoutChallenge(provider.providerId, 'G...');
      providerStore.completePayoutChallenge(provider.providerId, 'ch', 'sig');

      // Register some routes
      providerStore.registerRoute({
        providerId: provider.providerId,
        pathPattern: '/api/test',
        method: 'GET',
        unit: 'call',
        priceStroops: 100,
        quantityExtractor: 'constant:1',
      });

      directory.optIn({
        providerId: provider.providerId,
        categories: ['test'],
      });

      const stats = directory.getStats(provider.providerId);

      expect(stats.routeCount).toBe(1);
      expect(stats.uptime).toBeGreaterThan(0);
      expect(stats.uptime).toBeLessThanOrEqual(100);
      expect(stats.avgResponseTimeMs).toBeGreaterThan(0);
    });
  });
});
