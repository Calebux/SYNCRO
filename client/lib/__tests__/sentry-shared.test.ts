import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildRelease,
  resolveRelease,
  resolveEnvironment,
  scrubEvent,
  SENTRY_TAG_KEYS,
} from '../../../shared/src/sentry';

// ---------------------------------------------------------------------------
// buildRelease
// ---------------------------------------------------------------------------
describe('buildRelease', () => {
  it('returns version-only release when no SHA is provided', () => {
    expect(buildRelease('1.2.3')).toBe('syncro@1.2.3');
  });

  it('appends short SHA when provided', () => {
    expect(buildRelease('1.2.3', 'abcdef1234567890')).toBe('syncro@1.2.3+abcdef1');
  });
});

// ---------------------------------------------------------------------------
// resolveRelease
// ---------------------------------------------------------------------------
describe('resolveRelease', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns SENTRY_RELEASE when set', () => {
    process.env.SENTRY_RELEASE = 'custom-release';
    expect(resolveRelease()).toBe('custom-release');
  });

  it('falls back to npm_package_version + COMMIT_SHA', () => {
    delete process.env.SENTRY_RELEASE;
    process.env.npm_package_version = '2.0.0';
    process.env.COMMIT_SHA = 'deadbeef';
    expect(resolveRelease()).toBe('syncro@2.0.0+deadbee');
  });

  it('returns undefined when no version info is available', () => {
    delete process.env.SENTRY_RELEASE;
    delete process.env.npm_package_version;
    expect(resolveRelease()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveEnvironment
// ---------------------------------------------------------------------------
describe('resolveEnvironment', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns SENTRY_ENVIRONMENT when set', () => {
    process.env.SENTRY_ENVIRONMENT = 'staging';
    expect(resolveEnvironment()).toBe('staging');
  });

  it('falls back to NODE_ENV', () => {
    delete process.env.SENTRY_ENVIRONMENT;
    process.env.NODE_ENV = 'production';
    expect(resolveEnvironment()).toBe('production');
  });

  it('defaults to development', () => {
    delete process.env.SENTRY_ENVIRONMENT;
    delete process.env.NODE_ENV;
    expect(resolveEnvironment()).toBe('development');
  });
});

// ---------------------------------------------------------------------------
// SENTRY_TAG_KEYS
// ---------------------------------------------------------------------------
describe('SENTRY_TAG_KEYS', () => {
  it('exports expected keys', () => {
    expect(SENTRY_TAG_KEYS.service).toBe('service');
    expect(SENTRY_TAG_KEYS.category).toBe('category');
    expect(SENTRY_TAG_KEYS.component).toBe('component');
    expect(SENTRY_TAG_KEYS.cspDirective).toBe('csp_directive');
  });
});

// ---------------------------------------------------------------------------
// scrubEvent
// ---------------------------------------------------------------------------
describe('scrubEvent', () => {
  it('redacts sensitive request headers', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
          Cookie: 'session=abc123',
          'X-Api-Key': 'key-123',
        },
      },
    };

    const result = scrubEvent(event);

    expect(result.request.headers.Authorization).toBe('[Redacted]');
    expect(result.request.headers.Cookie).toBe('[Redacted]');
    expect(result.request.headers['X-Api-Key']).toBe('[Redacted]');
    expect(result.request.headers['Content-Type']).toBe('application/json');
  });

  it('redacts cookies entirely', () => {
    const event = {
      request: {
        cookies: { session: 'abc', token: 'xyz' },
      },
    };

    const result = scrubEvent(event);
    expect(result.request.cookies).toBe('[Redacted]');
  });

  it('redacts sensitive fields in JSON body string', () => {
    const body = JSON.stringify({
      username: 'alice',
      password: 'super-secret',
      token: 'jwt-here',
    });

    const event = { request: { data: body } };
    const result = scrubEvent(event);
    const parsed = JSON.parse(result.request.data);

    expect(parsed.username).toBe('alice');
    expect(parsed.password).toBe('[Redacted]');
    expect(parsed.token).toBe('[Redacted]');
  });

  it('redacts sensitive fields in object body', () => {
    const event = {
      request: {
        data: {
          email: 'alice@test.com',
          mnemonic: '12 word phrase',
          api_key: 'ak-123',
        },
      },
    };

    const result = scrubEvent(event);
    expect(result.request.data.email).toBe('alice@test.com');
    expect(result.request.data.mnemonic).toBe('[Redacted]');
    expect(result.request.data.api_key).toBe('[Redacted]');
  });

  it('redacts sensitive fields in extras', () => {
    const event = {
      extra: {
        context: 'login',
        password: 'oops',
        nested: { secret: 'hidden' },
      },
    };

    const result = scrubEvent(event);
    expect(result.extra.context).toBe('login');
    expect(result.extra.password).toBe('[Redacted]');
    expect(result.extra.nested.secret).toBe('[Redacted]');
  });

  it('scrubs breadcrumb data', () => {
    const event = {
      breadcrumbs: [
        { message: 'click', data: { token: 'abc', url: '/login' } },
        { message: 'navigate', data: { page: '/home' } },
      ],
    };

    const result = scrubEvent(event);
    expect(result.breadcrumbs[0].data.token).toBe('[Redacted]');
    expect(result.breadcrumbs[0].data.url).toBe('/login');
    expect(result.breadcrumbs[1].data.page).toBe('/home');
  });

  it('strips user fields except id', () => {
    const event = {
      user: { id: 'u-123', email: 'alice@test.com', ip_address: '1.2.3.4' },
    };

    const result = scrubEvent(event);
    expect(result.user).toEqual({ id: 'u-123' });
  });

  it('handles events with no request gracefully', () => {
    const event = { message: 'simple error' };
    const result = scrubEvent(event);
    expect(result.message).toBe('simple error');
  });

  it('handles non-JSON string body without error', () => {
    const event = { request: { data: 'plain text body' } };
    const result = scrubEvent(event);
    expect(result.request.data).toBe('plain text body');
  });
});
