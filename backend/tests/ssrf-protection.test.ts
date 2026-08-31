/**
 * Tests for SSRF (Server-Side Request Forgery) protection utilities.
 *
 * Coverage:
 *  - validateOutboundUrlSync  — synchronous schema-level check (no DNS)
 *  - validateOutboundUrl      — async check with optional DNS resolution
 *
 * Blocked ranges under test:
 *  - 169.254.0.0/16  link-local / AWS/GCP/Azure IMDS
 *  - 127.0.0.0/8     loopback (IPv4)
 *  - ::1             loopback (IPv6)
 *  - 10.0.0.0/8      RFC-1918 private
 *  - 172.16.0.0/12   RFC-1918 private
 *  - 192.168.0.0/16  RFC-1918 private
 *  - 100.64.0.0/10   CGNAT
 *  - metadata.google.internal / metadata.goog  blocked hostnames
 *  - IPv4-mapped IPv6 (::ffff:...)
 *
 * Allowed cases:
 *  - Public HTTPS URLs
 *  - Public HTTP URLs when allowHttp = true
 */

import dns from 'dns/promises';

import {
  validateOutboundUrl,
  validateOutboundUrlSync,
  SSRFError,
  type SSRFErrorCode,
} from '../src/utils/ssrf-protection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Call validateOutboundUrlSync and assert it returns { valid: false }. */
function expectBlocked(url: string, allowHttp = false, expectedReason?: RegExp) {
  const result = validateOutboundUrlSync(url, allowHttp);
  expect(result.valid).toBe(false);
  if (expectedReason) {
    expect(result.reason).toMatch(expectedReason);
  }
  return result;
}

/** Call validateOutboundUrlSync and assert it returns { valid: true }. */
function expectAllowed(url: string, allowHttp = false) {
  const result = validateOutboundUrlSync(url, allowHttp);
  expect(result).toEqual({ valid: true });
  return result;
}

// ---------------------------------------------------------------------------
// validateOutboundUrlSync — synchronous variant
// ---------------------------------------------------------------------------

describe('validateOutboundUrlSync', () => {
  // ── Malformed URLs ──────────────────────────────────────────────────────
  describe('malformed / empty input', () => {
    it('rejects an empty string', () => {
      expectBlocked('', false, /invalid url/i);
    });

    it('rejects a plain string without scheme', () => {
      expectBlocked('example.com/path', false, /invalid url/i);
    });

    it('rejects a javascript: URL', () => {
      expectBlocked('javascript:alert(1)', false);
    });

    it('rejects a file: URL', () => {
      expectBlocked('file:///etc/passwd', false);
    });
  });

  // ── Protocol enforcement ────────────────────────────────────────────────
  describe('protocol enforcement', () => {
    it('allows https:// by default', () => {
      expectAllowed('https://example.com/webhook');
    });

    it('blocks http:// by default', () => {
      expectBlocked('http://example.com/webhook', false, /disallowed protocol/i);
    });

    it('allows http:// when allowHttp = true', () => {
      expectAllowed('http://example.com/webhook', true);
    });

    it('blocks ftp://', () => {
      expectBlocked('ftp://example.com/file', false, /disallowed protocol/i);
    });
  });

  // ── 169.254.x.x — link-local / cloud metadata ──────────────────────────
  describe('169.254.x.x — link-local / IMDS', () => {
    it('blocks the AWS/GCP/Azure metadata endpoint 169.254.169.254', () => {
      expectBlocked('https://169.254.169.254/', false, /private or reserved/i);
    });

    it('blocks 169.254.0.1 (start of range)', () => {
      expectBlocked('https://169.254.0.1/', false, /private or reserved/i);
    });

    it('blocks 169.254.255.255 (end of range)', () => {
      expectBlocked('https://169.254.255.255/', false, /private or reserved/i);
    });

    it('blocks 169.254.100.100 (mid-range)', () => {
      expectBlocked('https://169.254.100.100/latest/meta-data/', false, /private or reserved/i);
    });
  });

  // ── Loopback ────────────────────────────────────────────────────────────
  describe('loopback addresses', () => {
    it('blocks 127.0.0.1', () => {
      expectBlocked('https://127.0.0.1/', false, /private or reserved/i);
    });

    it('blocks 127.0.0.2', () => {
      expectBlocked('https://127.0.0.2/', false, /private or reserved/i);
    });

    it('blocks 127.255.255.255', () => {
      expectBlocked('https://127.255.255.255/', false, /private or reserved/i);
    });

    it('blocks IPv6 loopback ::1', () => {
      expectBlocked('https://[::1]/', false, /private or reserved/i);
    });

    it('blocks IPv6 loopback ::1 with path', () => {
      expectBlocked('https://[::1]/api/secret', false, /private or reserved/i);
    });
  });

  // ── RFC-1918 private ranges ─────────────────────────────────────────────
  describe('RFC-1918 private IP ranges', () => {
    it('blocks 10.0.0.1', () => {
      expectBlocked('https://10.0.0.1/', false, /private or reserved/i);
    });

    it('blocks 10.255.255.255', () => {
      expectBlocked('https://10.255.255.255/', false, /private or reserved/i);
    });

    it('blocks 172.16.0.1', () => {
      expectBlocked('https://172.16.0.1/', false, /private or reserved/i);
    });

    it('blocks 172.31.255.255 (end of RFC-1918-B)', () => {
      expectBlocked('https://172.31.255.255/', false, /private or reserved/i);
    });

    it('blocks 192.168.0.1', () => {
      expectBlocked('https://192.168.0.1/', false, /private or reserved/i);
    });

    it('blocks 192.168.255.254', () => {
      expectBlocked('https://192.168.255.254/', false, /private or reserved/i);
    });
  });

  // ── CGNAT ───────────────────────────────────────────────────────────────
  describe('CGNAT range 100.64.0.0/10', () => {
    it('blocks 100.64.0.1', () => {
      expectBlocked('https://100.64.0.1/', false, /private or reserved/i);
    });

    it('blocks 100.127.255.255 (end of CGNAT)', () => {
      expectBlocked('https://100.127.255.255/', false, /private or reserved/i);
    });
  });

  // ── Blocked metadata hostnames ──────────────────────────────────────────
  describe('blocked cloud-metadata hostnames', () => {
    it('blocks metadata.google.internal', () => {
      expectBlocked('https://metadata.google.internal/', false, /explicitly blocked/i);
    });

    it('blocks metadata.goog', () => {
      expectBlocked('https://metadata.goog/', false, /explicitly blocked/i);
    });

    it('blocks instance-data', () => {
      expectBlocked('https://instance-data/', false, /explicitly blocked/i);
    });

    it('blocks instance-data.ec2.internal', () => {
      expectBlocked('https://instance-data.ec2.internal/', false, /explicitly blocked/i);
    });
  });

  // ── IPv4-mapped IPv6 ────────────────────────────────────────────────────
  describe('IPv4-mapped IPv6 addresses', () => {
    it('blocks ::ffff:127.0.0.1 (loopback mapped)', () => {
      expectBlocked('https://[::ffff:127.0.0.1]/', false, /private or reserved/i);
    });

    it('blocks ::ffff:169.254.169.254 (IMDS mapped)', () => {
      expectBlocked('https://[::ffff:169.254.169.254]/', false, /private or reserved/i);
    });

    it('blocks ::ffff:10.0.0.1 (private mapped)', () => {
      expectBlocked('https://[::ffff:10.0.0.1]/', false, /private or reserved/i);
    });

    it('blocks ::ffff:192.168.1.100 (private mapped)', () => {
      expectBlocked('https://[::ffff:192.168.1.100]/', false, /private or reserved/i);
    });
  });

  // ── IPv6 link-local / unique-local ──────────────────────────────────────
  describe('IPv6 private ranges', () => {
    it('blocks fe80:: link-local', () => {
      expectBlocked('https://[fe80::1]/', false, /private or reserved/i);
    });

    it('blocks fc00:: unique-local', () => {
      expectBlocked('https://[fc00::1]/', false, /private or reserved/i);
    });

    it('blocks fd00:: unique-local', () => {
      expectBlocked('https://[fd00::1]/', false, /private or reserved/i);
    });
  });

  // ── Allowed (public) addresses ──────────────────────────────────────────
  describe('allowlist — public addresses', () => {
    it('allows a typical public HTTPS webhook URL', () => {
      expectAllowed('https://example.com/webhook');
    });

    it('allows a public IP (1.1.1.1 Cloudflare DNS)', () => {
      expectAllowed('https://1.1.1.1/');
    });

    it('allows 8.8.8.8 (Google DNS)', () => {
      expectAllowed('https://8.8.8.8/');
    });

    it('allows a subdomain-based URL', () => {
      expectAllowed('https://hooks.slack.com/services/T000/B000/xxxx');
    });

    it('allows a URL with query params', () => {
      expectAllowed('https://api.example.com/v2/events?token=abc123');
    });

    it('does NOT allow 172.32.0.1 — just outside RFC-1918-B (172.16-31)', () => {
      // 172.32.0.1 is not in the blocked range; should pass sync check
      expectAllowed('https://172.32.0.1/', false);
    });

    it('allows http with allowHttp=true for testing', () => {
      expectAllowed('http://public-api.example.com/v1/data', true);
    });
  });
});

// ---------------------------------------------------------------------------
// validateOutboundUrl — async variant (DNS mocked for unit tests)
// ---------------------------------------------------------------------------

describe('validateOutboundUrl', () => {
  describe('synchronous checks (no DNS, resolveDns=false)', () => {
    it('returns parsed URL for a valid public HTTPS URL', async () => {
      const result = await validateOutboundUrl('https://example.com/webhook', { resolveDns: false });
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe('example.com');
    });

    it('throws SSRFError for 169.254.169.254', async () => {
      await expect(
        validateOutboundUrl('https://169.254.169.254/', { resolveDns: false }),
      ).rejects.toThrow(SSRFError);
    });

    it('throws SSRFError with code PRIVATE_IP for 127.0.0.1', async () => {
      const err = await validateOutboundUrl('https://127.0.0.1/', { resolveDns: false }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('PRIVATE_IP');
    });

    it('throws SSRFError with code BLOCKED_HOSTNAME for metadata.google.internal', async () => {
      const err = await validateOutboundUrl('https://metadata.google.internal/', {
        resolveDns: false,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('BLOCKED_HOSTNAME');
    });

    it('throws SSRFError with code DISALLOWED_PROTOCOL for http:// (default)', async () => {
      const err = await validateOutboundUrl('http://example.com/', { resolveDns: false }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('DISALLOWED_PROTOCOL');
    });

    it('throws SSRFError with code INVALID_URL for garbage input', async () => {
      const err = await validateOutboundUrl('not-a-url', { resolveDns: false }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('INVALID_URL');
    });
  });

  // ── DNS resolution guard (mocked) ──────────────────────────────────────
  describe('DNS resolution guard', () => {
    const dnsMock = jest.spyOn(dns, 'lookup');

    afterEach(() => {
      dnsMock.mockReset();
    });

    afterAll(() => {
      dnsMock.mockRestore();
    });

    it('rejects a hostname that resolves to 169.254.169.254 (DNS rebinding)', async () => {
      dnsMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);

      await expect(
        validateOutboundUrl('https://rebind-demo.example.com/', { resolveDns: true }),
      ).rejects.toThrow(SSRFError);

      const err = await validateOutboundUrl('https://rebind-demo.example.com/', {
        resolveDns: true,
      }).catch((e: unknown) => e);
      expect((err as SSRFError).code).toBe('PRIVATE_IP');
    });

    it('rejects a hostname that resolves to 127.0.0.1', async () => {
      dnsMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);

      const err = await validateOutboundUrl('https://localhost-rebind.example.com/', {
        resolveDns: true,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('PRIVATE_IP');
    });

    it('rejects a hostname that resolves to a private 10.x.x.x address', async () => {
      dnsMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as any);

      const err = await validateOutboundUrl('https://internal.example.com/', {
        resolveDns: true,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('PRIVATE_IP');
    });

    it('rejects a hostname that resolves to an IPv6 loopback ::1', async () => {
      dnsMock.mockResolvedValue([{ address: '::1', family: 6 }] as any);

      const err = await validateOutboundUrl('https://v6loopback.example.com/', {
        resolveDns: true,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('PRIVATE_IP');
    });

    it('rejects when any resolved address is private (multi-A records)', async () => {
      // First address is public, second is private → should still be blocked
      dnsMock.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },   // example.com public IP
        { address: '169.254.169.254', family: 4 }, // injected private address
      ] as any);

      const err = await validateOutboundUrl('https://multi-a.example.com/', {
        resolveDns: true,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('PRIVATE_IP');
    });

    it('resolves to a public IP and allows the request', async () => {
      dnsMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

      const result = await validateOutboundUrl('https://example.com/', { resolveDns: true });
      expect(result).toBeInstanceOf(URL);
    });

    it('throws SSRFError with code DNS_RESOLUTION_FAILED when lookup fails', async () => {
      dnsMock.mockRejectedValue(new Error('ENOTFOUND'));

      const err = await validateOutboundUrl('https://nonexistent.invalid/', {
        resolveDns: true,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('DNS_RESOLUTION_FAILED');
    });
  });

  // ── http allowance ──────────────────────────────────────────────────────
  describe('allowHttp option', () => {
    it('allows http when allowHttp=true', async () => {
      const result = await validateOutboundUrl('http://example.com/', {
        allowHttp: true,
        resolveDns: false,
      });
      expect(result).toBeInstanceOf(URL);
    });

    it('still blocks private IPs even with allowHttp=true', async () => {
      const err = await validateOutboundUrl('http://10.0.0.1/', {
        allowHttp: true,
        resolveDns: false,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).code).toBe('PRIVATE_IP');
    });
  });
});

// ---------------------------------------------------------------------------
// SSRFError shape
// ---------------------------------------------------------------------------

describe('SSRFError', () => {
  it('has the correct name property', () => {
    const err = new SSRFError('blocked', 'PRIVATE_IP');
    expect(err.name).toBe('SSRFError');
  });

  it('exposes the code on the instance', () => {
    const codes: SSRFErrorCode[] = [
      'INVALID_URL',
      'DISALLOWED_PROTOCOL',
      'BLOCKED_HOSTNAME',
      'PRIVATE_IP',
      'DNS_RESOLUTION_FAILED',
    ];
    for (const code of codes) {
      const err = new SSRFError(`test ${code}`, code);
      expect(err.code).toBe(code);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
