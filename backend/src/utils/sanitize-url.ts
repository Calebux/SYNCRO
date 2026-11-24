import { sanitizeUrl as sanitizeSharedUrl } from '@syncro/shared/security';

/**
 * Sanitizes a URL to ensure it only uses safe protocols (http or https).
 *
 * This prevents injection of dangerous URIs such as `javascript:`, `data:`,
 * or `vbscript:` into email templates and push notification payloads.
 *
 * @param url - The URL string to sanitize, or null/undefined.
 * @returns The original URL string if it is a valid http/https URL, otherwise '#'.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  return sanitizeSharedUrl(url);
}
