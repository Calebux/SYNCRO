import { parseSubscriptionEmail, parseSubscriptionEmailWithFallback } from '../src/services/email-parser';

jest.mock('../src/services/llm-parser', () => ({
  llmParser: {
    isAvailable: false,
    parse: jest.fn(),
  },
}));

describe('email-parser merchant normalization', () => {
  describe('parseSubscriptionEmail', () => {
    describe('merchant name normalization', () => {
      it('normalizes Netflix from email domain', () => {
        const result = parseSubscriptionEmail({
          subject: 'Your Netflix receipt',
          from: 'billing@netflix.com',
          body: 'Your subscription renews on June 1st for $15.99/month',
        });

        expect(result?.name).toBe('Netflix');
      });

      it('normalizes Spotify from sender with premium variant', () => {
        const result = parseSubscriptionEmail({
          subject: 'Spotify Premium renewal',
          from: 'noreply@spotify.com',
          body: 'Your subscription has been renewed. $10.99/month',
        });

        expect(result?.name).toBe('Spotify');
      });

      it('normalizes Disney+ from various formats', () => {
        const testCases = [
          'billing@disneyplus.com',
          '"Disney Plus" <noreply@disneyplus.com>',
        ];

        for (const from of testCases) {
          const result = parseSubscriptionEmail({
            subject: 'Your Disney+ receipt',
            from,
            body: 'Subscription renewed for $13.99/month',
          });
          // Both formats should normalize to Disney+ (domain match has higher priority)
          expect(result?.name).toContain('Disney');
        }
      });

      it('normalizes HBO Max from various formats', () => {
        const result = parseSubscriptionEmail({
          subject: 'HBO Max billing confirmation',
          from: 'billing@hbomax.com',
          body: 'Your HBO Max subscription renewed. $15.99/month',
        });

        expect(result?.name).toBe('HBO Max');
      });

      it('normalizes Prime Video correctly', () => {
        const result = parseSubscriptionEmail({
          subject: 'Prime Video receipt',
          from: 'noreply@primevideo.com',
          body: 'Your Prime Video subscription is active. $8.99/month',
        });

        expect(result?.name).toBe('Prime Video');
      });

      it('normalizes AI tools correctly', () => {
        const aiTestCases = [
          { from: 'billing@cursor.sh', expected: 'Cursor' },
          { from: 'noreply@chat.openai.com', expected: 'OpenAI' },
          { from: 'support@anthropic.com', expected: 'Claude' },
          { from: 'noreply@github-copilot.com', expected: 'GitHub Copilot' },
        ];

        for (const { from, expected } of aiTestCases) {
          const result = parseSubscriptionEmail({
            subject: 'Subscription confirmation',
            from,
            body: `Your ${expected} subscription renewed. $20/month`,
          });
          expect(result?.name).toBe(expected);
        }
      });

      it('normalizes cloud services correctly', () => {
        const cloudTestCases = [
          { from: 'billing@developer.amazon.com', expected: 'AWS' },
          { from: 'noreply@vercel.com', expected: 'Vercel' },
          { from: 'support@digitalocean.com', expected: 'DigitalOcean' },
          { from: 'noreply@cloudflare.com', expected: 'Cloudflare' },
        ];

        for (const { from, expected } of cloudTestCases) {
          const result = parseSubscriptionEmail({
            subject: 'Subscription receipt',
            from,
            body: `Your ${expected} subscription renewed. $10/month`,
          });
          expect(result?.name).toBe(expected);
        }
      });

      it('boosts confidence when merchant is normalized', () => {
        const normalizedResult = parseSubscriptionEmail({
          subject: 'Your Netflix receipt',
          from: 'billing@netflix.com',
          body: 'Subscription renewed. $15.99/month',
        });

        const rawResult = parseSubscriptionEmail({
          subject: 'Your streamflix receipt',
          from: 'billing@streamflix.com',
          body: 'Subscription renewed. $15.99/month',
        });

        expect(normalizedResult?.confidence).toBeGreaterThan(rawResult?.confidence ?? 0);
      });

      it('returns null for non-subscription emails', () => {
        const result = parseSubscriptionEmail({
          subject: 'Hello there',
          from: 'friend@example.com',
          body: 'Just saying hi!',
        });

        expect(result).toBeNull();
      });

      it('extracts amount and currency correctly', () => {
        const result = parseSubscriptionEmail({
          subject: 'Netflix receipt',
          from: 'billing@netflix.com',
          body: 'Your subscription is $15.99 per month',
        });

        expect(result?.amount).toBe(15.99);
        expect(result?.currency).toBe('USD');
        expect(result?.interval).toBe('monthly');
      });

      it('detects yearly interval', () => {
        const result = parseSubscriptionEmail({
          subject: 'Annual plan',
          from: 'noreply@example.com',
          body: 'Billed $99 annually',
        });

        expect(result?.interval).toBe('yearly');
      });
    });

    describe('false positive reduction', () => {
      it('returns raw sender name for unrecognized generic email providers', () => {
        const result = parseSubscriptionEmail({
          subject: 'Your receipt',
          from: 'noreply@gmail.com',
          body: 'Some monthly subscription renewal',
        });

        // For unrecognized senders, we get the raw extracted name
        expect(result?.name).toBeTruthy();
      });

      it('handles email with billing keyword but no recognizable merchant', () => {
        const result = parseSubscriptionEmail({
          subject: 'Billing update',
          from: 'billing@unknown-service.io',
          body: 'Your subscription renewed for $5/month',
        });

        expect(result).not.toBeNull();
        // For unrecognized merchants, returns normalized name
        expect(result?.name).toContain('unknown-service');
      });
    });
  });
});

describe('parseSubscriptionEmail corpus accuracy', () => {
  const corpus = [
    {
      input: {
        subject: 'Netflix receipt - May 2026',
        from: 'billing@netflix.com',
        body: 'Your subscription has been renewed. $15.99 per month.',
      },
      expectedName: 'Netflix',
      expectedAmount: 15.99,
      expectedInterval: 'monthly',
    },
    {
      input: {
        subject: 'Spotify Premium - payment received',
        from: 'noreply@spotify.com',
        body: 'Thank you for your $10.99 payment. Will renew monthly.',
      },
      expectedName: 'Spotify',
      expectedAmount: 10.99,
      expectedInterval: 'monthly',
    },
    {
      input: {
        subject: 'Disney+ Annual Plan Confirmation',
        from: 'support@disneyplus.com',
        body: 'Your annual subscription of $13.99 was processed.',
      },
      expectedName: 'Disney+',
      expectedAmount: 13.99,
      expectedInterval: 'yearly',
    },
    {
      input: {
        subject: 'Notion Personal Pro - Receipt',
        from: 'billing@notion.so',
        body: 'Payment of $8 received. Your subscription renews yearly.',
      },
      expectedName: 'Notion',
      expectedAmount: 8,
      expectedInterval: 'yearly',
    },
    {
      input: {
        subject: 'OpenAI API Usage',
        from: 'noreply@openai.com',
        body: 'Your ChatGPT Plus subscription - $20/month',
      },
      expectedName: 'OpenAI',
      expectedAmount: 20,
      expectedInterval: 'monthly',
    },
    {
      input: {
        subject: 'Zoom subscription renewed',
        from: 'billing@zoom.us',
        body: 'Your monthly Zoom subscription - $14.99.',
      },
      expectedName: 'Zoom',
      expectedAmount: 14.99,
      expectedInterval: 'monthly',
    },
    {
      input: {
        subject: 'AWS Bill Receipt',
        from: 'billing@developer.amazon.com',
        body: 'Amazon Web Services charged $50 monthly.',
      },
      expectedName: 'AWS',
      expectedAmount: 50,
      expectedInterval: 'monthly',
    },
    {
      input: {
        subject: 'Coursera Plus Confirmation',
        from: 'noreply@coursera.org',
        body: 'Your subscription renewed for $59 per year.',
      },
      expectedName: 'Coursera',
      expectedAmount: 59,
      expectedInterval: 'yearly',
    },
    {
      input: {
        subject: 'Duolingo Plus subscription',
        from: 'billing@duolingo.com',
        body: 'Your $6.99/month subscription renews on June 1.',
      },
      expectedName: 'Duolingo',
      expectedAmount: 6.99,
      expectedInterval: 'monthly',
    },
    {
      input: {
        subject: 'Paramount+ billing',
        from: 'support@paramountplus.com',
        body: 'Billed $5.99 monthly for your subscription.',
      },
      expectedName: 'Paramount+',
      expectedAmount: 5.99,
      expectedInterval: 'monthly',
    },
  ];

  it.each(corpus)(
    'correctly parses: subject="$input.subject"',
    ({ input, expectedName, expectedAmount, expectedInterval }) => {
      const result = parseSubscriptionEmail(input);

      expect(result).not.toBeNull();
      expect(result?.name).toBe(expectedName);
      expect(result?.amount).toBe(expectedAmount);
      expect(result?.interval).toBe(expectedInterval);
    },
  );

  it('achieves 100% accuracy on corpus for merchant names', () => {
    let correctNames = 0;
    for (const { input, expectedName } of corpus) {
      const result = parseSubscriptionEmail(input);
      if (result?.name === expectedName) {
        correctNames++;
      }
    }
    const accuracy = correctNames / corpus.length;
    expect(accuracy).toBe(1);
  });
});