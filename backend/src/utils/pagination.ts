import { z } from 'zod';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(MAX_LIMIT, `Limit must not exceed ${MAX_LIMIT}`).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;

export interface ValidatedCursor {
  createdAt: string;
}

export class PaginationError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_CURSOR' | 'INVALID_LIMIT' | 'MALFORMED_CURSOR',
  ) {
    super(message);
    this.name = 'PaginationError';
  }
}

export function validateCursor(cursor: string | undefined): ValidatedCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    if (!parsed || typeof parsed !== 'object') {
      throw new PaginationError('Cursor must decode to a valid object', 'MALFORMED_CURSOR');
    }

    const createdAt = parsed.createdAt ?? parsed.created_at;
    if (!createdAt || typeof createdAt !== 'string') {
      throw new PaginationError('Invalid cursor: missing created_at field', 'MALFORMED_CURSOR');
    }

    return { createdAt };
  } catch (error) {
    if (error instanceof PaginationError) {
      throw error;
    }
    throw new PaginationError('Invalid pagination cursor', 'INVALID_CURSOR');
  }
}

export function validateLimit(limit: unknown, max: number = MAX_LIMIT, defaultVal: number = DEFAULT_LIMIT): number {
  if (limit === undefined || limit === null || limit === '') {
    return defaultVal;
  }

  const parsed = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);

  if (isNaN(parsed) || !Number.isInteger(parsed)) {
    throw new PaginationError('Limit must be a valid integer', 'INVALID_LIMIT');
  }

  if (parsed < 1) {
    throw new PaginationError(`Limit must be at least 1`, 'INVALID_LIMIT');
  }

  if (parsed > max) {
    throw new PaginationError(`Limit must not exceed ${max}`, 'INVALID_LIMIT');
  }

  return parsed;
}

export function encodeCursor(data: { createdAt: string }): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  limit: number,
  nextCursor: string | null,
) {
  return {
    items,
    pagination: {
      total,
      limit,
      hasMore: nextCursor !== null,
      nextCursor,
    },
  };
}