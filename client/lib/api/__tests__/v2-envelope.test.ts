import { v2SuccessSchema, v2ProblemSchema, v2Success, v2Problem } from '@/lib/api/v2-envelope'
import { encodeV2Cursor, decodeV2Cursor, CursorError } from '@/lib/api/v2-cursor'

describe('client v2 envelope', () => {
  it('success body matches the contract', async () => {
    const res = v2Success({ status: 'ok' }, 'req_1')
    const body = await res.json()
    expect(v2SuccessSchema.safeParse(body).success).toBe(true)
    expect(body.meta.version).toBe('v2')
  })

  it('problem body matches RFC 7807', async () => {
    const res = v2Problem({
      type: 'https://syncro.app/problems/validation',
      title: 'Validation Error',
      status: 400,
      detail: 'bad',
      instance: '/api/v2/health',
      requestId: 'req_1',
    })
    expect(res.headers.get('content-type')).toMatch(/problem\+json/)
    const body = await res.json()
    expect(v2ProblemSchema.safeParse(body).success).toBe(true)
  })

  it('cursor is opaque and signed', () => {
    const token = encodeV2Cursor({ createdAt: '2026-01-01T00:00:00.000Z', id: '1' })
    expect(decodeV2Cursor(token)).toEqual({ createdAt: '2026-01-01T00:00:00.000Z', id: '1' })
    expect(() => decodeV2Cursor('nope')).toThrow(CursorError)
  })
})
