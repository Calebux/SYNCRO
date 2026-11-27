const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

export function isSafeHttpUrl(value: string | null | undefined, maxLength = 2000): boolean {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    return false;
  }

  try {
    return SAFE_URL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function sanitizeUrl(value: string | null | undefined, fallback = '#'): string {
  if (!isSafeHttpUrl(value)) {
    return fallback;
  }

  return new URL(value as string).toString();
}

export function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!local || !domain) return value;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function maskApiKey(
  value: string,
  options: { visiblePrefix?: number; visibleSuffix?: number; shortMask?: string } = {},
): string {
  const visiblePrefix = options.visiblePrefix ?? 7;
  const visibleSuffix = options.visibleSuffix ?? 4;
  const shortMask = options.shortMask ?? '••••••••';

  if (!value || value.length < visiblePrefix + visibleSuffix) {
    return shortMask;
  }

  return `${value.slice(0, visiblePrefix)}...${value.slice(-visibleSuffix)}`;
}
