import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

const EXTENSION_BLOCKLIST = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'ms-browser-extension://',
  'about:',
];

function isExtensionFalsePositive(blockedUri?: string): boolean {
  if (!blockedUri) return false;
  return EXTENSION_BLOCKLIST.some((prefix) => blockedUri.startsWith(prefix));
}

function normalizeCspReport(body: unknown): {
  'document-uri': string;
  'violated-directive': string;
  'blocked-uri'?: string;
  'source-file'?: string;
  'line-number'?: number;
  'column-number'?: number;
  'disposition'?: 'enforce' | 'report';
  'status-code'?: number;
  'script-sample'?: string;
} | null {
  if (!body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;

  // CSP3 report-to format: { type: 'csp-violation', body: { ... } }
  if (obj.type === 'csp-violation' && obj.body && typeof obj.body === 'object') {
    const b = obj.body as Record<string, unknown>;
    return {
      'document-uri': String(b.documentURL || b['document-uri'] || ''),
      'violated-directive': String(b.effectiveDirective || b['violated-directive'] || ''),
      'blocked-uri': b.blockedURL
        ? String(b.blockedURL)
        : b['blocked-uri']
        ? String(b['blocked-uri'])
        : undefined,
      'source-file': b.sourceFile ? String(b.sourceFile) : undefined,
      'line-number': typeof b.lineNumber === 'number' ? b.lineNumber : undefined,
      'column-number': typeof b.columnNumber === 'number' ? b.columnNumber : undefined,
      'disposition':
        b.disposition === 'enforce' || b.disposition === 'report' ? b.disposition : undefined,
      'status-code': typeof b.statusCode === 'number' ? b.statusCode : undefined,
      'script-sample': b.sample ? String(b.sample) : undefined,
    };
  }

  // report-uri format: { 'csp-report': { ... } }
  if (obj['csp-report'] && typeof obj['csp-report'] === 'object') {
    const r = obj['csp-report'] as Record<string, unknown>;
    return {
      'document-uri': String(r['document-uri'] || ''),
      'violated-directive': String(r['violated-directive'] || ''),
      'blocked-uri': r['blocked-uri'] ? String(r['blocked-uri']) : undefined,
      'source-file': r['source-file'] ? String(r['source-file']) : undefined,
      'line-number': typeof r['line-number'] === 'number' ? r['line-number'] : undefined,
      'column-number': typeof r['column-number'] === 'number' ? r['column-number'] : undefined,
      'disposition':
        r['disposition'] === 'enforce' || r['disposition'] === 'report'
          ? r['disposition']
          : undefined,
      'status-code': typeof r['status-code'] === 'number' ? r['status-code'] : undefined,
      'script-sample': r['script-sample'] ? String(r['script-sample']) : undefined,
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    let rawBody: unknown;

    try {
      rawBody = await req.json();
    } catch {
      return new NextResponse(null, { status: 204 });
    }

    // Handle application/reports+json (array of reports) or single report
    const reports: unknown[] = Array.isArray(rawBody) ? rawBody : [rawBody];

    for (const item of reports) {
      const report = normalizeCspReport(item);
      if (!report) continue;

      if (!report['document-uri'] || !report['violated-directive']) continue;

      if (isExtensionFalsePositive(report['blocked-uri'])) continue;

      const context = {
        userAgent: req.headers.get('user-agent') || undefined,
        ipAddress:
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          req.headers.get('x-real-ip') ||
          undefined,
        referer: req.headers.get('referer') || undefined,
      };

      // Forward to backend; fire-and-forget so we always return 204 quickly
      fetch(`${BACKEND_URL}/api/csp-violations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-request': 'true',
        },
        body: JSON.stringify({ report, context }),
      }).catch(() => {
        // Swallow intentionally — CSP reporting must never surface errors to the browser
      });
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    // Always return 204 so browsers don't retry aggressively
    return new NextResponse(null, { status: 204 });
  }
}
