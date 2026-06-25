// ─── Module mocks (hoisted by Jest before any import executes) ────────────────
jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}))

// ─── Imports ──────────────────────────────────────────────────────────────────
import { metadataExtractionOnly, logScanMetadata } from '../src/services/email-scanner'
import type { RawScanResult, ReceiptMetadata } from '../src/services/email-scanner'
import logger from '../src/config/logger'

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Builds a baseline RawScanResult. Pass `overrides` to customise any field
 * (including `body` and `rawContent` which exist outside the whitelist).
 */
function makeRaw(
  overrides: Partial<RawScanResult & { body?: string; rawContent?: string }> = {},
): RawScanResult {
  return {
    provider: 'gmail',
    messageId: 'msg-001',
    threadId: 'thread-001',
    receivedAt: '2024-06-01T10:00:00Z',
    from: 'billing@netflix.com',
    subject: 'Your Netflix receipt',
    name: 'Netflix',
    amount: 15.99,
    currency: 'USD',
    interval: 'monthly',
    signals: ['receipt', 'billing'],
    confidence: 0.9,
    proof: { hash: 'abc123', contentHash: 'def456', algorithm: 'sha256' },
    ...overrides,
  }
}

/**
 * Returns a fresh Supabase-shaped mock whose `from` chain resolves successfully
 * by default. Create a new instance per test so call counts never bleed across
 * tests.
 */
function makeSupabaseMock() {
  return {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: null }),
    }),
  }
}

// ─── metadataExtractionOnly ───────────────────────────────────────────────────

describe('metadataExtractionOnly', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── 1 ─────────────────────────────────────────────────────────────────────
  it('returns an empty array when given an empty array', () => {
    expect(metadataExtractionOnly([])).toEqual([])
  })

  // ── 2 ─────────────────────────────────────────────────────────────────────
  it('sets bodyExcluded to true on every result', () => {
    const result = metadataExtractionOnly([makeRaw()])
    expect(result[0].bodyExcluded).toBe(true)
  })

  // ── 3 ─────────────────────────────────────────────────────────────────────
  it('preserves all allowed receipt metadata fields', () => {
    const raw = makeRaw()
    const result = metadataExtractionOnly([raw])
    const r = result[0]

    expect(r.provider).toBe(raw.provider)
    expect(r.messageId).toBe(raw.messageId)
    expect(r.threadId).toBe(raw.threadId)
    expect(r.receivedAt).toBe(raw.receivedAt)
    expect(r.from).toBe(raw.from)
    expect(r.subject).toBe(raw.subject)
    expect(r.name).toBe(raw.name)
    expect(r.amount).toBe(raw.amount)
    expect(r.currency).toBe(raw.currency)
    expect(r.interval).toBe(raw.interval)
    expect(r.signals).toEqual(raw.signals)
    expect(r.confidence).toBe(raw.confidence)
    expect(r.proof).toEqual(raw.proof)
  })

  // ── 4 ─────────────────────────────────────────────────────────────────────
  it('strips the body field when present in raw input', () => {
    const result = metadataExtractionOnly([
      makeRaw({ body: 'Hi there, thanks for subscribing! Here is your receipt...' }),
    ])
    expect('body' in result[0]).toBe(false)
  })

  // ── 5 ─────────────────────────────────────────────────────────────────────
  it('strips rawContent when present in raw input', () => {
    const result = metadataExtractionOnly([makeRaw({ rawContent: '<html>...</html>' })])
    expect('rawContent' in result[0]).toBe(false)
  })

  // ── 6 ─────────────────────────────────────────────────────────────────────
  it('strips unknown extra fields and calls logger.warn', () => {
    const result = metadataExtractionOnly([
      makeRaw({ somePrivateField: 'secret', anotherField: 42 } as any),
    ])

    expect('somePrivateField' in result[0]).toBe(false)
    expect('anotherField' in result[0]).toBe(false)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching('stripped unexpected fields'),
      expect.objectContaining({
        unknownKeys: expect.arrayContaining(['somePrivateField', 'anotherField']),
      }),
    )
  })

  // ── 7 ─────────────────────────────────────────────────────────────────────
  it('does NOT call logger.warn when no unexpected fields exist', () => {
    metadataExtractionOnly([makeRaw()])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // ── 8 ─────────────────────────────────────────────────────────────────────
  it('calls logger.info for each extracted record', () => {
    metadataExtractionOnly([
      makeRaw({ messageId: 'msg-a' }),
      makeRaw({ messageId: 'msg-b' }),
    ])

    expect(logger.info).toHaveBeenCalledTimes(2)

    const calls = (logger.info as jest.Mock).mock.calls
    expect(calls[0][0]).toMatch('Receipt metadata extracted')
    expect(calls[1][0]).toMatch('Receipt metadata extracted')
  })

  // ── 9 ─────────────────────────────────────────────────────────────────────
  it('handles null / undefined optional fields gracefully', () => {
    const raw = makeRaw({
      amount: null,
      currency: null,
      interval: null,
      threadId: null,
      from: null,
      subject: null,
      name: null,
    })

    // Explicitly assert it does not throw
    expect(() => metadataExtractionOnly([raw])).not.toThrow()

    const result = metadataExtractionOnly([raw])
    expect(result[0].amount).toBeNull()
    expect(result[0].currency).toBeNull()
    expect(result[0].interval).toBeNull()
    expect(result[0].threadId).toBeNull()
    expect(result[0].from).toBeNull()
    expect(result[0].subject).toBeNull()
    expect(result[0].name).toBeNull()
  })

  // ── 10 ────────────────────────────────────────────────────────────────────
  it('handles multiple raw results', () => {
    const raws = [
      makeRaw({ messageId: 'msg-1' }),
      makeRaw({ messageId: 'msg-2' }),
      makeRaw({ messageId: 'msg-3' }),
    ]
    const result = metadataExtractionOnly(raws)

    expect(result).toHaveLength(3)
    result.forEach((r) => expect(r.bodyExcluded).toBe(true))
  })

  // ── 11 ────────────────────────────────────────────────────────────────────
  it('strips body even when combined with unknown fields', () => {
    const result = metadataExtractionOnly([
      makeRaw({ body: 'some body text', unknownExtra: 'value' } as any),
    ])

    expect('body' in result[0]).toBe(false)
    expect('unknownExtra' in result[0]).toBe(false)
  })

  // ── 12 ────────────────────────────────────────────────────────────────────
  it('does not include body in the logger.info call', () => {
    metadataExtractionOnly([makeRaw({ body: 'conversational text' })])

    const infoCalls = (logger.info as jest.Mock).mock.calls
    infoCalls.forEach((callArgs) => {
      const serialized = JSON.stringify(callArgs)
      expect(serialized).not.toContain('conversational text')
    })
  })
})

// ─── logScanMetadata ──────────────────────────────────────────────────────────

describe('logScanMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── 1 ─────────────────────────────────────────────────────────────────────
  it('does nothing when metadata array is empty', async () => {
    const supabaseMock = makeSupabaseMock()

    await logScanMetadata('user-1', [], supabaseMock as any)

    expect(supabaseMock.from).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })

  // ── 2 ─────────────────────────────────────────────────────────────────────
  it('inserts rows into audit_logs table', async () => {
    const supabaseMock = makeSupabaseMock()
    const metadata = metadataExtractionOnly([makeRaw()])

    await logScanMetadata('user-1', metadata, supabaseMock as any)

    expect(supabaseMock.from).toHaveBeenCalledWith('audit_logs')
    const insertMock = supabaseMock.from().insert as jest.Mock
    expect(insertMock).toHaveBeenCalledTimes(1)
  })

  // ── 3 ─────────────────────────────────────────────────────────────────────
  it('each inserted row has action = email_receipt_extracted and resource_type = email_scan', async () => {
    const supabaseMock = makeSupabaseMock()
    const metadata = metadataExtractionOnly([makeRaw()])

    await logScanMetadata('user-1', metadata, supabaseMock as any)

    const insertMock = supabaseMock.from().insert as jest.Mock
    const rows = insertMock.mock.calls[0][0]

    expect(rows[0].action).toBe('email_receipt_extracted')
    expect(rows[0].resource_type).toBe('email_scan')
    expect(rows[0].user_id).toBe('user-1')
  })

  // ── 4 ─────────────────────────────────────────────────────────────────────
  it('the metadata payload in each row never contains a body field', async () => {
    const supabaseMock = makeSupabaseMock()
    const metadata = metadataExtractionOnly([makeRaw()])

    await logScanMetadata('user-1', metadata, supabaseMock as any)

    const insertMock = supabaseMock.from().insert as jest.Mock
    const rows = insertMock.mock.calls[0][0]

    expect(rows[0].metadata.body).toBeUndefined()
    expect(rows[0].metadata.rawContent).toBeUndefined()
  })

  // ── 5 ─────────────────────────────────────────────────────────────────────
  it('the metadata payload contains amount, currency, and receivedAt', async () => {
    const supabaseMock = makeSupabaseMock()
    const metadata = metadataExtractionOnly([makeRaw()])

    await logScanMetadata('user-1', metadata, supabaseMock as any)

    const insertMock = supabaseMock.from().insert as jest.Mock
    const rows = insertMock.mock.calls[0][0]

    expect(rows[0].metadata.amount).toBe(15.99)
    expect(rows[0].metadata.currency).toBe('USD')
    expect(rows[0].metadata.receivedAt).toBe('2024-06-01T10:00:00Z')
  })

  // ── 6 ─────────────────────────────────────────────────────────────────────
  it('the metadata payload always includes bodyExcluded: true', async () => {
    const supabaseMock = makeSupabaseMock()
    const metadata = metadataExtractionOnly([makeRaw()])

    await logScanMetadata('user-1', metadata, supabaseMock as any)

    const insertMock = supabaseMock.from().insert as jest.Mock
    const rows = insertMock.mock.calls[0][0]

    expect(rows[0].metadata.bodyExcluded).toBe(true)
  })

  // ── 7 ─────────────────────────────────────────────────────────────────────
  it('throws and logs on database error', async () => {
    const supabaseMock = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: { message: 'DB failure' } }),
      }),
    }
    const metadata = metadataExtractionOnly([makeRaw()])

    await expect(
      logScanMetadata('user-1', metadata, supabaseMock as any),
    ).rejects.toBeDefined()

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching('Failed to log scan metadata'),
      expect.anything(),
    )
  })

  // ── 8 ─────────────────────────────────────────────────────────────────────
  it('inserts all records in a single bulk call', async () => {
    const supabaseMock = makeSupabaseMock()
    const metadata = metadataExtractionOnly([
      makeRaw({ messageId: 'msg-1' }),
      makeRaw({ messageId: 'msg-2' }),
      makeRaw({ messageId: 'msg-3' }),
    ])

    await logScanMetadata('user-1', metadata, supabaseMock as any)

    const insertMock = supabaseMock.from().insert as jest.Mock
    expect(insertMock).toHaveBeenCalledTimes(1)

    const rows = insertMock.mock.calls[0][0]
    expect(rows).toHaveLength(3)
  })
})
