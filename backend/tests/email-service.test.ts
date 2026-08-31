import { sanitizeUrl } from '../src/utils/sanitize-url';
import { EmailService } from '../src/services/email-service';
import { NotificationPayload } from '../src/types/reminder';

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    verify: jest.fn().mockResolvedValue(true),
    sendMail: jest.fn().mockResolvedValue({
      messageId: 'test-message-id',
      accepted: ['test@example.com'],
      rejected: [],
    }),
  }),
}));

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

// Helper to build a minimal NotificationPayload
function makePayload(renewalUrl: string | null): NotificationPayload {
  return {
    title: 'Reminder',
    body: 'Your subscription renews soon',
    subscription: {
      id: 'sub-1',
      user_id: 'user-1',
      name: 'Netflix',
      price: 15.99,
      billing_cycle: 'monthly',
      status: 'active',
      category: 'Entertainment',
      renewal_url: renewalUrl,
      active_until: '2025-01-01T00:00:00Z',
    },
    daysBefore: 7,
    renewalDate: '2026-04-01',
    reminderType: 'renewal',
  };
}

// ─── sanitizeUrl unit tests ────────────────────────────────────────────────────

describe('sanitizeUrl()', () => {
  it('allows a valid https URL unchanged', () => {
    expect(sanitizeUrl('https://netflix.com/account')).toBe('https://netflix.com/account');
  });

  it('allows a valid http URL unchanged', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('blocks javascript: URIs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
  });

  it('blocks data: URIs', () => {
    expect(sanitizeUrl('data:text/html,<h1>phish</h1>')).toBe('#');
  });

  it('blocks vbscript: URIs', () => {
    expect(sanitizeUrl('vbscript:MsgBox(1)')).toBe('#');
  });

  it('blocks ftp: URIs', () => {
    expect(sanitizeUrl('ftp://evil.com/file')).toBe('#');
  });

  it('returns # for malformed strings', () => {
    expect(sanitizeUrl('not-a-url')).toBe('#');
  });

  it('returns # for null', () => {
    expect(sanitizeUrl(null)).toBe('#');
  });

  it('returns # for empty string', () => {
    expect(sanitizeUrl('')).toBe('#');
  });

  it('returns # for whitespace-only string', () => {
    expect(sanitizeUrl('   ')).toBe('#');
  });
});

// ─── EmailService HTML template tests ─────────────────────────────────────────

describe('EmailService - getEmailTemplate() URL sanitization', () => {
  const service = new EmailService({ from: 'test@test.com' });

  // Access the private method via any cast for testing
  const getTemplate = (payload: NotificationPayload): string =>
    (service as any).getEmailTemplate(payload);

  it('embeds a valid https URL directly in the href', () => {
    const html = getTemplate(makePayload('https://netflix.com/account'));
    expect(html).toContain('href="https://netflix.com/account"');
    expect(html).not.toContain('javascript:');
  });

  it('replaces javascript: URL with # in the href', () => {
    const html = getTemplate(makePayload('javascript:evil()'));
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:evil()');
  });

  it('replaces data: URI with # in the href', () => {
    const html = getTemplate(makePayload('data:text/html,<script>alert(1)</script>'));
    expect(html).toContain('href="#"');
    expect(html).not.toContain('data:');
  });

  it('replaces a malformed URL with # in the href', () => {
    const html = getTemplate(makePayload('not-a-url'));
    expect(html).toContain('href="#"');
  });

  it('omits the button entirely when renewal_url is null', () => {
    const html = getTemplate(makePayload(null));
    expect(html).not.toContain('Manage Subscription');
  });
});

// ─── EmailService plain-text template tests ────────────────────────────────────

describe('EmailService - getEmailText() URL sanitization', () => {
  const service = new EmailService({ from: 'test@test.com' });

  const getText = (payload: NotificationPayload): string =>
    (service as any).getEmailText(payload);

  it('includes a valid https URL in plain text', () => {
    const text = getText(makePayload('https://netflix.com/account'));
    expect(text).toContain('https://netflix.com/account');
  });

  it('replaces javascript: URL with # in plain text', () => {
    const text = getText(makePayload('javascript:evil()'));
    expect(text).toContain('Manage Subscription: #');
    expect(text).not.toContain('javascript:');
  });

  it('omits the manage URL line when renewal_url is null', () => {
    const text = getText(makePayload(null));
    expect(text).not.toContain('Manage Subscription:');
  });
});
