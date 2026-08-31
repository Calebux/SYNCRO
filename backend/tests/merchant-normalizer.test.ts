import {
  normalizeMerchant,
  deduplicateMerchants,
  calculateSimilarity,
  getMerchantCanonicalForm,
  getMerchantPatterns,
} from '../utils/merchant-normalizer';

describe('merchant-normalizer', () => {
  describe('normalizeMerchant', () => {
    describe('domain-based matching', () => {
      it('matches Netflix from billing@netflix.com', () => {
        const result = normalizeMerchant('billing@netflix.com');
        expect(result).toEqual({
          canonicalName: 'Netflix',
          confidence: 0.95,
        });
      });

      it('matches Spotify from noreply@spotify.com', () => {
        const result = normalizeMerchant('noreply@spotify.com');
        expect(result).toEqual({
          canonicalName: 'Spotify',
          confidence: 0.95,
        });
      });

      it('matches Disney+ from support@disneyplus.com', () => {
        const result = normalizeMerchant('support@disneyplus.com');
        expect(result).toEqual({
          canonicalName: 'Disney+',
          confidence: 0.95,
        });
      });

      it('matches HBO Max from billing@hbomax.com', () => {
        const result = normalizeMerchant('billing@hbomax.com');
        expect(result).toEqual({
          canonicalName: 'HBO Max',
          confidence: 0.95,
        });
      });

      it('matches Prime Video from noreply@primevideo.com', () => {
        const result = normalizeMerchant('noreply@primevideo.com');
        expect(result).toEqual({
          canonicalName: 'Prime Video',
          confidence: 0.95,
        });
      });

      it('does not match generic apple.com (no subscription service pattern)', () => {
        const result = normalizeMerchant('noreply@apple.com');
        expect(result).toBeNull();
      });

      it('matches YouTube Premium from youtube.com domain', () => {
        const result = normalizeMerchant('billing@youtube.com');
        expect(result?.canonicalName).toBe('YouTube Premium');
        expect(result?.confidence).toBe(0.95);
      });

      it('matches Paramount+ from help@paramountplus.com', () => {
        const result = normalizeMerchant('help@paramountplus.com');
        expect(result).toEqual({
          canonicalName: 'Paramount+',
          confidence: 0.95,
        });
      });
    });

    describe('local-part based matching', () => {
      it('matches Netflix from "Netflix Billing" display name', () => {
        const result = normalizeMerchant('"Netflix Billing" <billing@netflix.com>');
        expect(result?.canonicalName).toBe('Netflix');
      });

      it('matches Spotify from "Spotify Premium" display name', () => {
        const result = normalizeMerchant('"Spotify Premium" <billing@spotify.com>');
        expect(result?.canonicalName).toBe('Spotify');
      });

      it('matches ChatGPT from ChatGPT Plus display name', () => {
        const result = normalizeMerchant('ChatGPT Plus <noreply@chat.openai.com>');
        expect(result?.canonicalName).toBe('OpenAI');
      });
    });

    describe('sender-based matching', () => {
      it('matches AWS from developer.amazon.com', () => {
        const result = normalizeMerchant('billing@developer.amazon.com');
        expect(result?.canonicalName).toBe('AWS');
        expect(result?.confidence).toBeGreaterThan(0.9);
      });

      it('matches AWS from Amazon Web Services display name with generic domain', () => {
        const result = normalizeMerchant('Amazon Web Services <noreply@example.com>');
        expect(result?.canonicalName).toBe('AWS');
      });

      it('matches Google Cloud from Google Cloud Platform', () => {
        const result = normalizeMerchant('Google Cloud Platform <noreply@example.com>');
        expect(result?.canonicalName).toBe('Google Cloud');
      });

      it('matches Microsoft 365 from Microsoft 365', () => {
        const result = normalizeMerchant('Microsoft 365 <billing@microsoft.com>');
        expect(result?.canonicalName).toBe('Microsoft 365');
      });

      it('returns null for unrecognized sender', () => {
        const result = normalizeMerchant('random-service@example.com');
        expect(result).toBeNull();
      });

      it('returns null for null/undefined input', () => {
        expect(normalizeMerchant(null)).toBeNull();
        expect(normalizeMerchant(undefined)).toBeNull();
      });
    });

    describe('priority-based matching', () => {
      it('gives higher priority to specific patterns over generic ones', () => {
        const result = normalizeMerchant('"Adobe Creative Cloud" <noreply@adobe.com>');
        expect(result?.canonicalName).toBe('Adobe');
      });
    });
  });

  describe('deduplicateMerchants', () => {
    it('removes exact duplicates', () => {
      const input = ['Netflix', 'Netflix', 'Spotify'];
      const result = deduplicateMerchants(input);
      expect(result).toEqual(['Netflix', 'Spotify']);
    });

    it('removes case-insensitive duplicates', () => {
      const input = ['Netflix', 'netflix', 'NETFLIX', 'Spotify'];
      const result = deduplicateMerchants(input);
      expect(result).toEqual(['Netflix', 'Spotify']);
    });

    it('removes near-duplicates based on similarity', () => {
      const input = ['Netflix', 'Netflix International', 'Spotify'];
      const result = deduplicateMerchants(input);
      expect(result).toEqual(['Netflix', 'Spotify']);
    });

    it('removes duplicates with different suffixes', () => {
      const input = ['Netflix', 'Netflix Premium', 'Netflix Billing', 'Spotify'];
      const result = deduplicateMerchants(input);
      expect(result).toEqual(['Netflix', 'Spotify']);
    });

    it('handles empty array', () => {
      expect(deduplicateMerchants([])).toEqual([]);
    });

    it('filters out null/undefined values', () => {
      const input = ['Netflix', null, 'Spotify', undefined, ''];
      const result = deduplicateMerchants(input);
      expect(result).toEqual(['Netflix', 'Spotify']);
    });

    it('keeps distinct merchants separate', () => {
      const input = ['Netflix', 'Hulu', 'Disney+', 'Spotify'];
      const result = deduplicateMerchants(input);
      expect(result).toEqual(['Netflix', 'Hulu', 'Disney+', 'Spotify']);
    });

    it('handles merchant variants that should deduplicate', () => {
      const input = ['Netflix.com', 'NETFLIX', 'Netflix Billing'];
      const result = deduplicateMerchants(input);
      // Netflix.com and NETFLIX should be deduplicated as similar
      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe('calculateSimilarity', () => {
    it('returns 1 for identical strings', () => {
      expect(calculateSimilarity('Netflix', 'Netflix')).toBe(1);
    });

    it('returns high score for one string containing the other', () => {
      expect(calculateSimilarity('Netflix', 'Netflix Premium')).toBe(0.9);
      expect(calculateSimilarity('Netflix International', 'Netflix')).toBe(0.9);
    });

    it('returns Jaccard-like score for partial overlap', () => {
      const similarity = calculateSimilarity('Netflix Streaming', 'Netflix Premium');
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('returns 0 for completely different strings', () => {
      expect(calculateSimilarity('Netflix', 'Spotify')).toBe(0);
    });

    it('handles case insensitivity', () => {
      expect(calculateSimilarity('Netflix', 'netflix')).toBe(1);
    });
  });

  describe('getMerchantCanonicalForm', () => {
    it('returns canonical form for known merchants', () => {
      expect(getMerchantCanonicalForm('billing@netflix.com')).toBe('Netflix');
      expect(getMerchantCanonicalForm('noreply@spotify.com')).toBe('Spotify');
    });

    it('returns normalized name for unknown merchants', () => {
      const result = getMerchantCanonicalForm('random-service@example.com');
      expect(result).toBeTruthy();
    });

    it('handles null input', () => {
      expect(getMerchantCanonicalForm(null)).toBe('');
    });

    it('removes common suffixes from unknown merchants', () => {
      const result = getMerchantCanonicalForm('"Netflix Billing"');
      expect(result).toContain('Netflix');
    });
  });

  describe('getMerchantPatterns', () => {
    it('returns a set of pattern strings', () => {
      const patterns = getMerchantPatterns();
      expect(patterns.size).toBeGreaterThan(50);
      const hasNetflix = Array.from(patterns).some(p => p.includes('netflix'));
      expect(hasNetflix).toBe(true);
    });
  });
});

describe('merchant-normalizer corpus testing', () => {
  const corpus = [
    { sender: 'billing@netflix.com', expected: 'Netflix' },
    { sender: '"Netflix International" <noreply@netflix.com>', expected: 'Netflix' },
    { sender: 'support@spotify.com', expected: 'Spotify' },
    { sender: '"Spotify Premium" <billing@spotify.com>', expected: 'Spotify' },
    { sender: 'noreply@disneyplus.com', expected: 'Disney+' },
    { sender: 'billing@hulu.com', expected: 'Hulu' },
    { sender: 'noreply@hbomax.com', expected: 'HBO Max' },
    { sender: 'billing@paramountplus.com', expected: 'Paramount+' },
    { sender: 'noreply@primevideo.com', expected: 'Prime Video' },
    { sender: 'billing@notion.so', expected: 'Notion' },
    { sender: 'noreply@openai.com', expected: 'OpenAI' },
    { sender: '"ChatGPT Plus" <noreply@chat.openai.com>', expected: 'OpenAI' },
    { sender: 'billing@figma.com', expected: 'Figma' },
    { sender: 'noreply@linear.app', expected: 'Linear' },
    { sender: 'billing@slack.com', expected: 'Slack' },
    { sender: 'noreply@zoom.us', expected: 'Zoom' },
    { sender: 'billing@developer.amazon.com', expected: 'AWS' },
    { sender: 'noreply@vercel.com', expected: 'Vercel' },
    { sender: 'billing@digitalocean.com', expected: 'DigitalOcean' },
    { sender: 'noreply@cloudflare.com', expected: 'Cloudflare' },
    { sender: 'billing@coursera.org', expected: 'Coursera' },
    { sender: 'noreply@udemy.com', expected: 'Udemy' },
    { sender: '"LinkedIn Learning" <noreply@linkedin.com>', expected: 'LinkedIn Learning' },
    { sender: 'billing@audible.com', expected: 'Audible' },
    { sender: 'noreply@scribd.com', expected: 'Scribd' },
    { sender: 'billing@1password.com', expected: '1Password' },
    { sender: 'noreply@nordvpn.com', expected: 'NordVPN' },
    { sender: 'billing@quickbooks.com', expected: 'QuickBooks' },
    { sender: 'noreply@xbox.com', expected: 'Xbox Game Pass' },
    { sender: '"PlayStation Plus" <billing@playstation.com>', expected: 'PlayStation Plus' },
    { sender: '"Peacock Premium" <noreply@peacock.com>', expected: 'Peacock' },
  ];

  it.each(corpus)('correctly normalizes "$sender" to "$expected"', ({ sender, expected }) => {
    const result = normalizeMerchant(sender);
    expect(result?.canonicalName).toBe(expected);
  });

  it('achieves high accuracy on corpus', () => {
    let correctCount = 0;
    for (const { sender, expected } of corpus) {
      const result = normalizeMerchant(sender);
      if (result?.canonicalName === expected) {
        correctCount++;
      }
    }
    const accuracy = correctCount / corpus.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });
});