/**
 * @deprecated Import from `./digest-email-service` instead.
 *
 * This module used to hold a second, drifting copy of `DigestEmailService`
 * (nothing imported it, and it had already diverged from the live one). It is
 * now a re-export so the two implementations cannot drift again — the N+1 audit
 * in issue #1095 covers the single implementation in `digest-email-service.ts`.
 */
export {
  DigestEmailService,
  digestEmailService,
  type DigestAuditInput,
  type DigestSendRequest,
  type DigestSendResult,
} from './digest-email-service';

export { buildMonthlySummaries, buildMonthlySummary } from './monthly-summary';
