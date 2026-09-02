import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const CURSOR_PREFIX = 'v2c'
const CURSOR_VERSION = 1

const payloadSchema = z.object({
  v: z.literal(CURSOR_VERSION),
  t: z.string().min(1),
  i: z.string().min(1),
})

export class CursorError extends Error {
  constructor(message = 'Invalid pagination cursor') {
    super(message)
    this.name = 'CursorError'
  }
}

function secret(): string {
  return process.env.CURSOR_SIGNING_SECRET || process.env.JWT_SECRET || 'syncro-dev-cursor-secret'
}

function hmac(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}

export function encodeV2Cursor(keyset: { createdAt: string; id: string }): string {
  const body = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, t: keyset.createdAt, i: keyset.id })).toString(
    'base64url',
  )
  return `${CURSOR_PREFIX}.${body}.${hmac(body)}`
}

export function decodeV2Cursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null
  const parts = cursor.split('.')
  if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX || !parts[1] || !parts[2]) {
    throw new CursorError()
  }
  const expected = hmac(parts[1])
  const a = Buffer.from(parts[2])
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new CursorError()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new CursorError()
  }
  const result = payloadSchema.safeParse(parsed)
  if (!result.success) throw new CursorError()
  return { createdAt: result.data.t, id: result.data.i }
}
