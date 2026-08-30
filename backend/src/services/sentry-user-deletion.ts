import * as Sentry from '@sentry/node';
import logger from '../config/logger';
import { env } from '../config/env';

/**
 * Request removal of a user's data from Sentry error tracking.
 * Uses the Sentry data deletion API when credentials are configured;
 * otherwise records a breadcrumb for operator follow-up.
 */
export async function removeUserFromSentry(userId: string): Promise<{ removed: boolean; method: string }> {
  const org = env.SENTRY_ORG;
  const project = env.SENTRY_PROJECT;
  const authToken = env.SENTRY_AUTH_TOKEN;

  if (org && project && authToken) {
    try {
      const response = await fetch(
        `https://sentry.io/api/0/projects/${org}/${project}/users/`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: userId }),
        },
      );

      if (response.ok || response.status === 404) {
        logger.info('Sentry user data removal requested', { userId, status: response.status });
        return { removed: true, method: 'sentry_api' };
      }

      logger.warn('Sentry user data removal API returned non-success', {
        userId,
        status: response.status,
      });
    } catch (err) {
      logger.error('Sentry user data removal API failed', { userId, err });
    }
  }

  // Fallback: clear user from Sentry isolation scope when API is unavailable
  try {
    Sentry.getCurrentScope().setUser(null);
  } catch {
    // Non-fatal if scope is unavailable
  }

  logger.info('Sentry user context scrubbed locally (API credentials not configured)', { userId });
  return { removed: false, method: 'local_scope_scrub' };
}
