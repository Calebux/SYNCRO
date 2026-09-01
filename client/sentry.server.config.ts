import * as Sentry from '@sentry/nextjs';
import { resolveRelease, resolveEnvironment, scrubEvent, SENTRY_TAG_KEYS } from '@syncro/shared/sentry';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: resolveRelease(),
  environment: resolveEnvironment(),
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  initialScope: {
    tags: { [SENTRY_TAG_KEYS.service]: 'client' },
  },
  beforeSend: scrubEvent,
});
