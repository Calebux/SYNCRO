import { z } from 'zod';
import { validateOutboundUrlSync } from '../utils/ssrf-protection';

// ─── Reusable URL schema ────────────────────────────────────────────────────
/**
 * Validates a URL string for use in user-supplied fields such as
 * logo_url, website_url, and renewal_url.
 *
 * Checks:
 *  - http or https protocol
 *  - not a private / reserved IPv4 or IPv6 address (SSRF protection)
 *  - not a blocked cloud-metadata hostname
 *
 * NOTE: This is a synchronous, schema-level check.  DNS rebinding is not
 * covered here; callers that make outbound requests should additionally
 * call validateOutboundUrl() (async) immediately before the fetch.
 */
export const safeUrlSchema = z
  .string()
  .max(2000, 'URL must not exceed 2000 characters')
  .url('Must be a valid URL')
  .refine(
    (val) => {
      const result = validateOutboundUrlSync(val, /* allowHttp */ true);
      return result.valid;
    },
    (val) => {
      const result = validateOutboundUrlSync(val, /* allowHttp */ true);
      return { message: result.reason ?? 'URL is not permitted' };
    },
  );

// ─── UUID param schema ──────────────────────────────────────────────────────
/** Validates that a route `:id` parameter is a valid UUID. */
export const uuidParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

// ─── Pagination query helpers ───────────────────────────────────────────────
/** Reusable limit/offset pagination for query strings. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Reusable cursor-based pagination schema. */
export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must not exceed 100').default(20),
  cursor: z.string().optional(),
});
