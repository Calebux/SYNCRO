import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CURSOR_PREFIX = 'v2c';
const CURSOR_VERSION = 1;

export class CursorError extends Error {
  readonly code = 'INVALID_CURSOR' as const;
  readonly status = 400;

  constructor(message = 'Invalid pagination cursor') {
    super(message);
    this.name = 'CursorError';
  }
}

const cursorPayloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  t: z.string().min(1),
  i: z.string().min(1),
});

export type CursorKeyset = {
  createdAt: string;
  id: string;
};

const isoDateSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

export const v2CursorQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(MAX_LIMIT, `Limit must not exceed ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

/**
 * Cursor query schema with optional inclusive date-range filters.
 * `from`/`to` bound the `created_at` column used for keyset pagination.
 */
export const v2CursorDateRangeQuerySchema = v2CursorQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

function signingSecret(): string {
  return (
    process.env.CURSOR_SIGNING_SECRET ||
    process.env.JWT_SECRET ||
    'syncro-dev-cursor-secret'
  );
}

function base64url(value: Buffer | string): string {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buf.toString('base64url');
}

function hmac(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

/**
 * Encode a keyset cursor. The token is opaque to clients: signed, versioned,
 * and not a public JSON object.
 */
export function encodeV2Cursor(keyset: CursorKeyset): string {
  const payload = JSON.stringify({
    v: CURSOR_VERSION,
    t: keyset.createdAt,
    i: keyset.id,
  });
  const body = base64url(payload);
  return `${CURSOR_PREFIX}.${body}.${hmac(body)}`;
}

/**
 * Decode and validate a v2 cursor. Rejects missing signatures, unknown
 * versions, and structurally invalid keysets.
 */
export function decodeV2Cursor(cursor: string | undefined | null): CursorKeyset | null {
  if (!cursor) {
    return null;
  }

  const parts = cursor.split('.');
  if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX || !parts[1] || !parts[2]) {
    throw new CursorError('Invalid pagination cursor');
  }

  const [, body, signature] = parts;
  const expected = hmac(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new CursorError('Invalid pagination cursor');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new CursorError('Invalid pagination cursor');
  }

  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new CursorError('Invalid pagination cursor');
  }

  return { createdAt: result.data.t, id: result.data.i };
}

export function parseV2ListQuery(query: Record<string, unknown>): {
  limit: number;
  cursor: CursorKeyset | null;
} {
  const parsed = v2CursorQuerySchema.parse(query);
  return {
    limit: parsed.limit,
    cursor: decodeV2Cursor(parsed.cursor),
  };
}

export type DateRange = {
  from: string | null;
  to: string | null;
};

/**
 * Parse a cursor list query that also accepts optional `from`/`to` date-range
 * filters. The limit is clamped to `MAX_LIMIT` by the schema.
 */
export function parseV2DateRangeListQuery(query: Record<string, unknown>): {
  limit: number;
  cursor: CursorKeyset | null;
  range: DateRange;
} {
  const parsed = v2CursorDateRangeQuerySchema.parse(query);
  return {
    limit: parsed.limit,
    cursor: decodeV2Cursor(parsed.cursor),
    range: {
      from: parsed.from ?? null,
      to: parsed.to ?? null,
    },
  };
}

/**
 * Apply a descending `(created_at, id)` keyset so inserts do not shift pages.
 * Returns a PostgREST-style filter pair the caller applies to a query builder.
 */
export function keysetFilter(cursor: CursorKeyset | null): {
  createdAt: string;
  id: string;
} | null {
  return cursor;
}

/**
 * Build the `next_cursor` for a page. Callers fetch `limit + 1` rows; when an
 * extra row is present the last returned row's keyset becomes the cursor.
 */
export function buildNextCursor<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): { page: T[]; next_cursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const next_cursor =
    hasMore && last ? encodeV2Cursor({ createdAt: last.created_at, id: last.id }) : null;
  return { page, next_cursor };
}

export { DEFAULT_LIMIT, MAX_LIMIT };
