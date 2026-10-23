import { z } from 'zod';

export const V2_VERSION = 'v2' as const;

export const v2MetaSchema = z.object({
  request_id: z.string().min(1),
  version: z.literal(V2_VERSION),
});

export const v2PaginationSchema = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  limit: z.number().int().min(1).max(100),
});

export const v2SuccessSchema = z.object({
  data: z.unknown(),
  meta: v2MetaSchema,
  pagination: v2PaginationSchema.optional(),
});

export const v2FieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const v2ProblemSchema = z.object({
  type: z.string().url().or(z.literal('about:blank')),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string(),
  request_id: z.string(),
  errors: z.array(v2FieldErrorSchema).optional(),
});

export type V2Meta = z.infer<typeof v2MetaSchema>;
export type V2Pagination = z.infer<typeof v2PaginationSchema>;
export type V2Success<T = unknown> = {
  data: T;
  meta: V2Meta;
  pagination?: V2Pagination;
};
export type V2Problem = z.infer<typeof v2ProblemSchema>;

export const V2_PROBLEM_TYPES = {
  validation: 'https://syncro.app/problems/validation',
  invalidCursor: 'https://syncro.app/problems/invalid-cursor',
  unauthorized: 'https://syncro.app/problems/unauthorized',
  forbidden: 'https://syncro.app/problems/forbidden',
  notFound: 'https://syncro.app/problems/not-found',
  conflict: 'https://syncro.app/problems/conflict',
  rateLimit: 'https://syncro.app/problems/rate-limit',
  internal: 'https://syncro.app/problems/internal',
} as const;

export interface Paginated<T> {
  items: T[];
  pagination: V2Pagination;
}

export function isPaginated<T>(value: unknown): value is Paginated<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'pagination' in value &&
    Array.isArray((value as Paginated<T>).items)
  );
}

export function paginate<T>(
  items: T[],
  pagination: V2Pagination,
): Paginated<T> {
  return { items, pagination };
}

export function wrapSuccess<T>(
  data: T,
  requestId: string,
  pagination?: V2Pagination,
): V2Success<T> {
  const body: V2Success<T> = {
    data,
    meta: { request_id: requestId, version: V2_VERSION },
  };
  if (pagination) {
    body.pagination = pagination;
  }
  return body;
}

export function wrapProblem(input: {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: Array<{ field: string; message: string }>;
}): V2Problem {
  const problem: V2Problem = {
    type: input.type,
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    request_id: input.requestId,
  };
  if (input.errors && input.errors.length > 0) {
    problem.errors = input.errors;
  }
  return problem;
}
