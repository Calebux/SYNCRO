/**
 * v2 response envelope for Next.js App Router handlers (`client/app/api/v2`).
 * Mirrors backend/src/http/v2/envelope.ts so generated clients see one shape.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

export const V2_VERSION = 'v2' as const

export const v2MetaSchema = z.object({
  request_id: z.string().min(1),
  version: z.literal(V2_VERSION),
})

export const v2PaginationSchema = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  limit: z.number().int().min(1).max(100),
})

export const v2SuccessSchema = z.object({
  data: z.unknown(),
  meta: v2MetaSchema,
  pagination: v2PaginationSchema.optional(),
})

export const v2ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
  request_id: z.string(),
  errors: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
})

export type V2Pagination = z.infer<typeof v2PaginationSchema>
export type V2Success<T = unknown> = {
  data: T
  meta: { request_id: string; version: typeof V2_VERSION }
  pagination?: V2Pagination
}

export function v2Success<T>(
  data: T,
  requestId: string,
  init?: { status?: number; pagination?: V2Pagination },
): NextResponse {
  const body: V2Success<T> = {
    data,
    meta: { request_id: requestId, version: V2_VERSION },
  }
  if (init?.pagination) {
    body.pagination = init.pagination
  }
  return NextResponse.json(body, { status: init?.status ?? 200 })
}

export function v2Problem(input: {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  requestId: string
  errors?: Array<{ field: string; message: string }>
}): NextResponse {
  return NextResponse.json(
    {
      type: input.type,
      title: input.title,
      status: input.status,
      detail: input.detail,
      instance: input.instance,
      request_id: input.requestId,
      ...(input.errors ? { errors: input.errors } : {}),
    },
    {
      status: input.status,
      headers: { 'content-type': 'application/problem+json' },
    },
  )
}

export function v2RequestId(request: Request): string {
  return request.headers.get('x-request-id') || crypto.randomUUID()
}
