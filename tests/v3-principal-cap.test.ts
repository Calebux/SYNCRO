import { describe, it, expect } from 'vitest';
import {
  PRINCIPAL_DAILY_CAP_EXCEEDED,
  PrincipalAggregateCap,
  PrincipalCapError,
} from '../backend/src/v3/principal-cap';

describe('Issue #1701: per-principal aggregate daily cap', () => {
  it('admits spend under the principal total across several agents', () => {
    const cap = new PrincipalAggregateCap();
    cap.setDailyLimit('principal-1', 50);

    // Three agents sharing one principal spend 10 USDC each.
    cap.checkAdmission('principal-1', 10);
    cap.recordSpend('principal-1', 10);
    cap.checkAdmission('principal-1', 10);
    cap.recordSpend('principal-1', 10);
    cap.checkAdmission('principal-1', 10);
    cap.recordSpend('principal-1', 10);

    expect(cap.spentUsdc('principal-1')).toBe(30);
    expect(cap.remainingUsdc('principal-1')).toBe(20);
  });

  it('rejects admission with a distinct code when the principal total would be exceeded', () => {
    const cap = new PrincipalAggregateCap();
    cap.setDailyLimit('principal-1', 50);
    cap.recordSpend('principal-1', 30);

    let error: unknown = null;
    try {
      cap.checkAdmission('principal-1', 25);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PrincipalCapError);
    expect((error as PrincipalCapError).code).toBe(PRINCIPAL_DAILY_CAP_EXCEEDED);
    expect((error as PrincipalCapError).code).toBe('principal_daily_cap_exceeded');
    expect(cap.remainingUsdc('principal-1')).toBe(20);
  });

  it('is a no-op when the principal set no limit', () => {
    const cap = new PrincipalAggregateCap();
    expect(cap.remainingUsdc('principal-unknown')).toBeNull();
    expect(() => cap.checkAdmission('principal-unknown', 500)).not.toThrow();
  });
});
