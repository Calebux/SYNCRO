/**
 * Tests for correlation ID middleware (Issue #943)
 *
 * Covers:
 *  - UUID v7 generation (time-ordered)
 *  - X-Correlation-ID response header (canonical)
 *  - x-request-id response header (backward compat)
 *  - Upstream X-Correlation-ID / X-Request-ID header respect
 *  - Sentry breadcrumb recording
 *  - runWithCorrelationId() uses UUID v7
 *  - getRequestId() outside request context returns undefined
 */

import { requestContextStorage, getRequestId } from '../src/middleware/requestContext';

// Mock Sentry
jest.mock('@sentry/node', () => ({
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
}));

interface MockResponse {
  headers: Record<string, string>;
  setHeader: (name: string, value: string) => void;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    headers: {},
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

describe('requestIdMiddleware — UUID v7 correlation IDs', () => {
  const { requestIdMiddleware } = require('../src/middleware/requestContext');
  const Sentry = require('@sentry/node');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── UUID v7 format validation ──────────────────────────────────────────

  it('generates a UUID v7 (time-ordered) when no upstream header is present', () => {
    const req: any = { headers: {} };
    const res = createMockRes();
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    const correlationId = res.headers['X-Correlation-ID'];
    expect(correlationId).toBeDefined();

    // UUID v7: the 3rd group starts with '7' (version nibble)
    const groups = correlationId.split('-');
    expect(groups).toHaveLength(5);
    expect(groups[2].charAt(0)).toBe('7');

    // Should be a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(correlationId)).toBe(true);
  });

  it('produces unique IDs across multiple requests', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const req: any = { headers: {} };
      const res = createMockRes();
      const next = jest.fn();

      requestIdMiddleware(req, res, next);
      const id = res.headers['X-Correlation-ID'];
      ids.add(id);
    }
    // All 100 IDs should be unique
    expect(ids.size).toBe(100);
  });

  // ── Header behavior ────────────────────────────────────────────────────

  it('sets both X-Correlation-ID and x-request-id response headers', () => {
    const req: any = { headers: {} };
    const res = createMockRes();
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(res.headers['X-Correlation-ID']).toBeDefined();
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['X-Correlation-ID']).toBe(res.headers['x-request-id']);
  });

  it('respects upstream X-Correlation-ID header', () => {
    const upstreamId = '019f107b-ef3a-72ec-986d-752cf6db0864';
    const req: any = {
      headers: { 'x-correlation-id': upstreamId },
    };
    const res = createMockRes();
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(res.headers['X-Correlation-ID']).toBe(upstreamId);
    expect(res.headers['x-request-id']).toBe(upstreamId);
  });

  it('respects upstream X-Request-ID header when X-Correlation-ID is absent', () => {
    const upstreamId = 'upstream-req-abc-123';
    const req: any = {
      headers: { 'x-request-id': upstreamId },
    };
    const res = createMockRes();
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(res.headers['X-Correlation-ID']).toBe(upstreamId);
    expect(res.headers['x-request-id']).toBe(upstreamId);
  });

  it('prefers X-Correlation-ID over X-Request-ID when both are present', () => {
    const correlationId = 'correlation-from-upstream';
    const requestId = 'request-from-upstream';
    const req: any = {
      headers: {
        'x-correlation-id': correlationId,
        'x-request-id': requestId,
      },
    };
    const res = createMockRes();
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(res.headers['X-Correlation-ID']).toBe(correlationId);
    expect(res.headers['x-request-id']).toBe(correlationId);
    expect(res.headers['x-request-id']).not.toBe(requestId);
  });

  it('attaches requestId to the Express request object', () => {
    const req: any = { headers: {} };
    const res = createMockRes();
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toBe(res.headers['X-Correlation-ID']);
  });

  // ── Sentry breadcrumb ──────────────────────────────────────────────────

  it('adds a Sentry breadcrumb with the correlation ID', () => {
    const req: any = { headers: {} };
    const res = createMockRes();
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const breadcrumb = Sentry.addBreadcrumb.mock.calls[0][0];
    expect(breadcrumb.category).toBe('request');
    expect(breadcrumb.level).toBe('info');
    expect(breadcrumb.data.correlationId).toBe(res.headers['X-Correlation-ID']);
    expect(breadcrumb.message).toContain(res.headers['X-Correlation-ID']);
  });

  // ── AsyncLocalStorage context ──────────────────────────────────────────

  it('makes correlation ID available via getRequestId() during request', () => {
    const req: any = { headers: {} };
    const res = createMockRes();
    let capturedId: string | undefined;

    const next = jest.fn(() => {
      capturedId = getRequestId();
    });

    requestIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(capturedId).toBeDefined();
    expect(capturedId).toBe(res.headers['X-Correlation-ID']);
  });

  it('returns undefined from getRequestId() outside request context', () => {
    // Call getRequestId() outside any request context
    expect(getRequestId()).toBeUndefined();
  });
});

// ─── runWithCorrelationId ─────────────────────────────────────────────────

describe('runWithCorrelationId()', () => {
  const { runWithCorrelationId } = require('../src/middleware/requestContext');

  it('generates a formatted correlation ID with label prefix and UUID v7', async () => {
    const result = await runWithCorrelationId('cron:test', async (cid) => {
      // cid should be accessible
      expect(cid).toBeDefined();
      expect(cid.startsWith('cron:test:')).toBe(true);

      // The UUID part after the label should be v7 format
      const uuidPart = cid.replace('cron:test:', '');
      const groups = uuidPart.split('-');
      expect(groups).toHaveLength(5);
      expect(groups[2].charAt(0)).toBe('7');
      return cid;
    });

    expect(result.startsWith('cron:test:')).toBe(true);
  });

  it('makes the correlation ID available via getRequestId() inside the callback', async () => {
    let capturedId: string | undefined;
    let capturedFromStore: string | undefined;

    await runWithCorrelationId('job:test', async (cid) => {
      capturedId = cid;
      capturedFromStore = getRequestId();
    });

    expect(capturedId).toBeDefined();
    expect(capturedFromStore).toBe(capturedId);
  });

  it('returns undefined from getRequestId() after the callback completes', async () => {
    await runWithCorrelationId('job:test', async () => {
      // Inside, it should be defined
      expect(getRequestId()).toBeDefined();
    });

    // After completion, no context
    expect(getRequestId()).toBeUndefined();
  });

  it('returns the callback result', async () => {
    const result = await runWithCorrelationId('test', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors from the callback', async () => {
    await expect(
      runWithCorrelationId('test', async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });
});
