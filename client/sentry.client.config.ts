import * as Sentry from '@sentry/nextjs';
import { resolveRelease, resolveEnvironment, scrubEvent, SENTRY_TAG_KEYS } from '../shared/src/sentry';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: resolveRelease(),
  environment: resolveEnvironment(),
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
  initialScope: {
    tags: { [SENTRY_TAG_KEYS.service]: 'client' },
  },
  beforeSend: scrubEvent,
});
