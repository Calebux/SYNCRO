/**
 * SSRF (Server-Side Request Forgery) Protection Utility
 *
 * Validates URLs supplied for outbound requests (webhooks, provider APIs,
 * calendar integrations) to ensure they do not target private networks,
 * loopback addresses, link-local ranges, or cloud-metadata endpoints.
 *
 * Issue: #640
 */

import dns from 'dns/promises';

// ---------------------------------------------------------------------------
// Allow / Deny rule configuration
// ---------------------------------------------------------------------------

/**
 * Protocols that are permitted for outbound requests.
 * Only HTTPS is allowed in production; HTTP is permitted in development/test
 * when the allowHttp option is passed explicitly.
 */
export const ALLOWED_PROTOCOLS = new Set(['https:']);

/**
 * Cloud instance metadata service hostnames that must always be blocked,
 * regardless of resolved IP address.
 *
 * References:
 *  - AWS:              169.254.169.254
 *  - GCP:              metadata.google.internal / 169.254.169.254
 *  - Azure:            169.254.169.254
 *  - DigitalOcean:     169.254.169.254
 */
export const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

/**
 * Private/reserved IPv4 CIDR ranges.
 *
 * Covers:
 *  - Loopback          127.0.0.0/8
 *  - Private (Class A) 10.0.0.0/8
 *  - Private (Class B) 172.16.0.0/12
 *  - Private (Class C) 192.168.0.0/16
 *  - Link-local / IMDS 169.254.0.0/16
 *  - CGNAT             100.64.0.0/10
 *  - "This" network    0.0.0.0/8
 *  - TEST-NET-1..3     192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
 *  - Reserved          240.0.0.0/4
 *  - Broadcast         255.255.255.255
 *
 * NOTE: We use multiplication instead of bit-shifts to avoid JavaScript's
 * signed-integer truncation when the high bit is set (e.g. 172.x, 192.x).
 */
const BLOCKED_IPV4_RANGES: Array<{ label: string; base: number; mask: number }> = [
  { label: 'loopback',         base: ipToUint32('127.0.0.0'),   mask: 0xff000000 },
  { label: 'RFC-1918-A',       base: ipToUint32('10.0.0.0'),    mask: 0xff000000 },
  { label: 'RFC-1918-B',       base: ipToUint32('172.16.0.0'),  mask: 0xfff00000 },
  { label: 'RFC-1918-C',       base: ipToUint32('192.168.0.0'), mask: 0xffff0000 },
  { label: 'link-local/IMDS',  base: ipToUint32('169.254.0.0'), mask: 0xffff0000 },
  { label: 'CGNAT',            base: ipToUint32('100.64.0.0'),  mask: 0xffc00000 },
  { label: 'this-network',     base: ipToUint32('0.0.0.0'),     mask: 0xff000000 },
  { label: 'TEST-NET-1',       base: ipToUint32('192.0.2.0'),   mask: 0xffffff00 },
  { label: 'TEST-NET-2',       base: ipToUint32('198.51.100.0'),mask: 0xffffff00 },
  { label: 'TEST-NET-3',       base: ipToUint32('203.0.113.0'), mask: 0xffffff00 },
  { label: 'reserved',         base: ipToUint32('240.0.0.0'),   mask: 0xf0000000 },
  { label: 'broadcast',        base: ipToUint32('255.255.255.255'), mask: 0xffffffff },
];

// ---------------------------------------------------------------------------
// Helper: IPv4 utilities
// ---------------------------------------------------------------------------

/**
 * Convert a dotted-decimal IPv4 string to an unsigned 32-bit integer.
 * Uses multiplication (not bit-shifts) to avoid JS signed-integer overflow.
 */
function ipToUint32(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    parts[0] * 16777216 +  // << 24
    parts[1] * 65536 +     // << 16
    parts[2] * 256 +       // << 8
    parts[3]
  );
}

function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

function isPrivateIPv4(ip: string): boolean {
  if (!isValidIPv4(ip)) return false;
  const n = ipToUint32(ip);
  return BLOCKED_IPV4_RANGES.some(({ base, mask }) => (n & mask) >>> 0 === base >>> 0);
}

// ---------------------------------------------------------------------------
// Helper: IPv6 utilities
// ---------------------------------------------------------------------------

/**
 * Parse an IPv4-mapped IPv6 address in the hex-group form that Node's URL
 * parser normalises to, e.g. ::ffff:c0a8:101 → "192.168.1.1".
 *
 * The URL spec normalises ::ffff:192.168.1.1 to ::ffff:c0a8:101 before
 * storing it as the hostname, so we must handle both forms.
 */
function extractIPv4FromMappedIPv6(lower: string): string | null {
  // Dotted-decimal form:  ::ffff:192.168.1.1
  const dotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];

  // Hex-group form (browser / Node URL normalisation): ::ffff:c0a8:101
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low  = parseInt(hex[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }

  return null;
}

function isPrivateIPv6(ip: string): boolean {
  // Strip surrounding brackets that may appear from URL.hostname
  const lower = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  // Loopback
  if (lower === '::1') return true;
  // Unspecified / any-address
  if (lower === '::') return true;

  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;

  // Unique-local fc00::/7
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;

  // IPv4-mapped ::ffff:x.x.x.x  (both dotted and hex-group forms)
  const mapped = extractIPv4FromMappedIPv6(lower);
  if (mapped !== null) return isPrivateIPv4(mapped);

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SSRFError extends Error {
  constructor(
    message: string,
    public readonly code: SSRFErrorCode,
  ) {
    super(message);
    this.name = 'SSRFError';
  }
}

export type SSRFErrorCode =
  | 'INVALID_URL'
  | 'DISALLOWED_PROTOCOL'
  | 'BLOCKED_HOSTNAME'
  | 'PRIVATE_IP'
  | 'DNS_RESOLUTION_FAILED';

export interface SSRFValidationOptions {
  /**
   * Allow HTTP in addition to HTTPS. Defaults to false.
   * Only enable this in development / test environments.
   */
  allowHttp?: boolean;

  /**
   * Perform a DNS lookup and validate the resolved IP(s).
   * Defaults to true. Disable only in unit tests.
   */
  resolveDns?: boolean;
}

/**
 * Validates that a URL is safe to use as an outbound request target.
 *
 * Throws an {@link SSRFError} with a descriptive `code` if the URL fails
 * any check. Returns the parsed {@link URL} object on success so callers
 * can reuse it without re-parsing.
 *
 * @example
 * ```ts
 * // In webhook dispatch:
 * await validateOutboundUrl(webhook.url);
 * const response = await fetch(webhook.url, { ... });
 * ```
 */
export async function validateOutboundUrl(
  rawUrl: string,
  options: SSRFValidationOptions = {},
): Promise<URL> {
  const { allowHttp = false, resolveDns = true } = options;

  // 1. Parse
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFError(`Invalid URL: ${rawUrl}`, 'INVALID_URL');
  }

  // 2. Protocol check
  const allowedProtocols = allowHttp
    ? new Set([...ALLOWED_PROTOCOLS, 'http:'])
    : ALLOWED_PROTOCOLS;

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new SSRFError(
      `Disallowed protocol "${parsed.protocol}". Only ${[...allowedProtocols].join(', ')} are permitted.`,
      'DISALLOWED_PROTOCOL',
    );
  }

  // 3. Hostname blocklist (e.g. metadata.google.internal)
  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SSRFError(
      `Hostname "${hostname}" is explicitly blocked.`,
      'BLOCKED_HOSTNAME',
    );
  }

  // 4. Reject if the hostname is already a private/loopback IP (no DNS needed)
  if (isPrivateIPv4(hostname)) {
    throw new SSRFError(
      `Target IP "${hostname}" is in a private or reserved range.`,
      'PRIVATE_IP',
    );
  }

  if (isPrivateIPv6(hostname)) {
    throw new SSRFError(
      `Target IPv6 address "${hostname}" is in a private or reserved range.`,
      'PRIVATE_IP',
    );
  }

  // 5. DNS resolution — guard against DNS rebinding / split-horizon attacks
  if (resolveDns) {
    let addresses: string[];
    try {
      const result = await dns.lookup(hostname, { all: true });
      addresses = result.map((r) => r.address);
    } catch (err) {
      throw new SSRFError(
        `DNS resolution failed for "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
        'DNS_RESOLUTION_FAILED',
      );
    }

    for (const address of addresses) {
      if (isPrivateIPv4(address)) {
        throw new SSRFError(
          `"${hostname}" resolves to a private IP address "${address}".`,
          'PRIVATE_IP',
        );
      }
      if (isPrivateIPv6(address)) {
        throw new SSRFError(
          `"${hostname}" resolves to a private IPv6 address "${address}".`,
          'PRIVATE_IP',
        );
      }
    }
  }

  return parsed;
}

/**
 * Synchronous URL validation without DNS resolution.
 * Suitable for Zod `.refine()` callbacks and request-time schema validation
 * where async is not supported.
 *
 * DNS-based rebinding protection is NOT available in this variant; always
 * pair with the async {@link validateOutboundUrl} before making the actual
 * outbound request.
 */
export function validateOutboundUrlSync(
  rawUrl: string,
  allowHttp = false,
): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  const allowedProtocols = allowHttp
    ? new Set([...ALLOWED_PROTOCOLS, 'http:'])
    : ALLOWED_PROTOCOLS;

  if (!allowedProtocols.has(parsed.protocol)) {
    return {
      valid: false,
      reason: `Disallowed protocol "${parsed.protocol}". Only ${[...allowedProtocols].join(', ')} are permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: `Hostname "${hostname}" is explicitly blocked.` };
  }

  if (isPrivateIPv4(hostname)) {
    return { valid: false, reason: `Target IP "${hostname}" is in a private or reserved range.` };
  }

  if (isPrivateIPv6(hostname)) {
    return { valid: false, reason: `Target IPv6 "${hostname}" is in a private or reserved range.` };
  }

  return { valid: true };
}