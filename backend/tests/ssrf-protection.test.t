/**
 * Tests for SSRF (Server-Side Request Forgery) protection utility
 * Issue: #640
 */

import dns from 'dns/promises';
import {
  validateOutboundUrl,
  validateOutboundUrlSync,
  SSRFError,
  BLOCKED_HOSTNAMES,
  ALLOWED_PROTOCOLS,
} from '../src/utils/ssrf-protection';

// ---------------------------------------------------------------------------
// Mock dns.lookup so tests don't make real network calls
// ---------------------------------------------------------------------------
jest.mock('dns/promises');
const mockDnsLookup = dns.lookup as jest.MockedFunction<typeof dns.lookup>;

function mockDns(addresses: string[]) {
  mockDnsLookup.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as any,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: resolve to a safe public IP
  mockDns(['93.184.216.34']); // example.com
});

// ===========================================================================
// validateOutboundUrl (async, with DNS)
// ===========================================================================

describe('validateOutboundUrl', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  describe('valid URLs', () => {
    it('accepts a public HTTPS URL', async () => {
      const url = await validateOutboundUrl('https://example.com/webhook');
      expect(url.hostname).toBe('example.com');
    });

    it('returns a URL object on success', async () => {
      const url = await validateOutboundUrl('https://hooks.slack.com/services/T000/B000/xxx');
      expect(url).toBeInstanceOf(URL);
    });

    it('accepts HTTPS with a non-standard port', async () => {
      await expect(validateOutboundUrl('https://example.com:8443/hook')).resolves.toBeDefined();
    });

    it('allows HTTP when allowHttp option is true', async () => {
      await expect(
        validateOutboundUrl('http://example.com/hook', { allowHttp: true }),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Protocol enforcement
  // -------------------------------------------------------------------------
  describe('protocol checks', () => {
    it('rejects HTTP by default', async () => {
      await expect(validateOutboundUrl('http://example.com/hook')).rejects.toThrow(SSRFError);
      await expect(validateOutboundUrl('http://example.com/hook')).rejects.toMatchObject({
        code: 'DISALLOWED_PROTOCOL',
      });
    });

    it('rejects ftp:// URLs', async () => {
      await expect(validateOutboundUrl('ftp://example.com/file')).rejects.toMatchObject({
        code: 'DISALLOWED_PROTOCOL',
      });
    });

    it('rejects file:// URLs', async () => {
      await expect(validateOutboundUrl('file:///etc/passwd')).rejects.toMatchObject({
        code: 'DISALLOWED_PROTOCOL',
      });
    });

    it('rejects javascript: URLs', async () => {
      await expect(validateOutboundUrl('javascript:alert(1)')).rejects.toMatchObject({
        code: 'DISALLOWED_PROTOCOL',
      });
    });

    it('rejects data: URLs', async () => {
      await expect(validateOutboundUrl('data:text/html,<h1>x</h1>')).rejects.toMatchObject({
        code: 'DISALLOWED_PROTOCOL',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Invalid URL format
  // -------------------------------------------------------------------------
  describe('invalid URL format', () => {
    it('rejects empty string', async () => {
      await expect(validateOutboundUrl('')).rejects.toMatchObject({ code: 'INVALID_URL' });
    });

    it('rejects plain hostname without scheme', async () => {
      await expect(validateOutboundUrl('example.com')).rejects.toMatchObject({ code: 'INVALID_URL' });
    });

    it('rejects garbage string', async () => {
      await expect(validateOutboundUrl('not a url at all')).rejects.toMatchObject({
        code: 'INVALID_URL',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Blocked hostnames (metadata endpoints)
  // -------------------------------------------------------------------------
  describe('blocked hostnames', () => {
    for (const host of BLOCKED_HOSTNAMES) {
      it(`rejects explicitly blocked hostname: ${host}`, async () => {
        await expect(validateOutboundUrl(`https://${host}/path`)).rejects.toMatchObject({
          code: 'BLOCKED_HOSTNAME',
        });
      });
    }
  });

  // -------------------------------------------------------------------------
  // Private IPv4 ranges (literal IPs in URL)
  // -------------------------------------------------------------------------
  describe('private IPv4 literals', () => {
    const privateCases = [
      ['loopback',                  'https://127.0.0.1/hook'],
      ['loopback high',             'https://127.255.0.1/hook'],
      ['RFC-1918 Class A',          'https://10.0.0.1/hook'],
      ['RFC-1918 Class A (high)',   'https://10.255.255.1/hook'],
      ['RFC-1918 Class B',          'https://172.16.0.1/hook'],
      ['RFC-1918 Class B boundary', 'https://172.31.255.255/hook'],
      ['RFC-1918 Class C',          'https://192.168.1.100/hook'],
      ['link-local / IMDS',         'https://169.254.169.254/latest/meta-data/'],
      ['CGNAT',                     'https://100.64.0.1/hook'],
    ];

    for (const [label, url] of privateCases) {
      it(`blocks ${label}: ${url}`, async () => {
        await expect(validateOutboundUrl(url)).rejects.toMatchObject({ code: 'PRIVATE_IP' });
      });
    }
  });

  // -------------------------------------------------------------------------
  // Private IPv6 ranges (literal IPs in URL)
  // -------------------------------------------------------------------------
  describe('private IPv6 literals', () => {
    it('blocks loopback ::1', async () => {
      await expect(validateOutboundUrl('https://[::1]/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('blocks link-local fe80::1', async () => {
      await expect(validateOutboundUrl('https://[fe80::1]/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('blocks unique-local fc00::1', async () => {
      await expect(validateOutboundUrl('https://[fc00::1]/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('blocks IPv4-mapped ::ffff:192.168.1.1', async () => {
      await expect(validateOutboundUrl('https://[::ffff:192.168.1.1]/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });
  });

  // -------------------------------------------------------------------------
  // DNS resolution checks (rebinding / split-horizon attacks)
  // -------------------------------------------------------------------------
  describe('DNS resolution', () => {
    it('blocks a hostname that resolves to a private IP', async () => {
      mockDns(['10.0.0.50']);
      await expect(validateOutboundUrl('https://evil.example.com/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('blocks a hostname that resolves to the loopback', async () => {
      mockDns(['127.0.0.1']);
      await expect(validateOutboundUrl('https://evil.example.com/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('blocks a hostname that resolves to the IMDS address', async () => {
      mockDns(['169.254.169.254']);
      await expect(validateOutboundUrl('https://evil.example.com/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('blocks a hostname resolving to a private IPv6 address', async () => {
      mockDns(['fe80::1']);
      await expect(validateOutboundUrl('https://evil.example.com/hook')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('fails gracefully when DNS lookup throws', async () => {
      mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(validateOutboundUrl('https://nonexistent.invalid/hook')).rejects.toMatchObject({
        code: 'DNS_RESOLUTION_FAILED',
      });
    });

    it('skips DNS when resolveDns=false', async () => {
      // Even if DNS would return a private IP, we skip it
      mockDns(['10.0.0.1']);
      await expect(
        validateOutboundUrl('https://example.com/hook', { resolveDns: false }),
      ).resolves.toBeDefined();
      expect(mockDnsLookup).not.toHaveBeenCalled();
    });

    it('accepts a hostname that resolves to a public IP', async () => {
      mockDns(['93.184.216.34']);
      await expect(validateOutboundUrl('https://example.com/hook')).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('is case-insensitive for hostnames', async () => {
      await expect(validateOutboundUrl('https://METADATA.GOOGLE.INTERNAL/')).rejects.toMatchObject({
        code: 'BLOCKED_HOSTNAME',
      });
    });

    it('handles IPv4-mapped IPv6 IMDS address ::ffff:169.254.169.254', async () => {
      await expect(
        validateOutboundUrl('https://[::ffff:169.254.169.254]/hook'),
      ).rejects.toMatchObject({ code: 'PRIVATE_IP' });
    });
  });
});

// ===========================================================================
// validateOutboundUrlSync (no DNS)
// ===========================================================================

describe('validateOutboundUrlSync', () => {
  it('returns valid=true for a public HTTPS URL', () => {
    expect(validateOutboundUrlSync('https://example.com/hook')).toEqual({ valid: true });
  });

  it('returns valid=false with reason for HTTP', () => {
    const result = validateOutboundUrlSync('https://127.0.0.1/hook');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private|reserved/i);
  });

  it('returns valid=false for blocked hostname', () => {
    const result = validateOutboundUrlSync('https://metadata.google.internal/');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/blocked/i);
  });

  it('returns valid=false with reason for invalid URL', () => {
    const result = validateOutboundUrlSync('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid url/i);
  });

  it('allows HTTP when allowHttp=true', () => {
    expect(validateOutboundUrlSync('http://example.com/hook', true)).toEqual({ valid: true });
  });
});

// ===========================================================================
// Constants sanity checks
// ===========================================================================

describe('configuration constants', () => {
  it('ALLOWED_PROTOCOLS only contains https: by default', () => {
    expect(ALLOWED_PROTOCOLS.has('https:')).toBe(true);
    expect(ALLOWED_PROTOCOLS.has('http:')).toBe(false);
    expect(ALLOWED_PROTOCOLS.has('ftp:')).toBe(false);
  });

  it('BLOCKED_HOSTNAMES contains known metadata endpoints', () => {
    expect(BLOCKED_HOSTNAMES.has('metadata.google.internal')).toBe(true);
    expect(BLOCKED_HOSTNAMES.has('metadata.goog')).toBe(true);
  });
});