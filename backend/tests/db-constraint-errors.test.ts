import { parseDbError } from '../src/utils/db-constraint-errors';

/**
 * Builds a fake Postgres error object for testing.
 * This lets us simulate what Supabase would return without
 * needing a real database connection.
 */
function pgErr(code: string, constraint: string) {
  return { code, constraint, message: `ERROR: ${constraint}` };
}

describe('parseDbError', () => {

  // ── inputs that should return null ──────────────────────────────

  it('returns null for undefined', () => {
    expect(parseDbError(undefined)).toBeNull();
  });

  it('returns null for a plain string', () => {
    expect(parseDbError('something went wrong')).toBeNull();
  });

  it('returns null for an unrelated Postgres error code', () => {
    expect(parseDbError({ code: '42703' })).toBeNull();
  });

  // ── tags ────────────────────────────────────────────────────────

  it('returns 409 for duplicate tag name', () => {
    const result = parseDbError(pgErr('23505', 'tags_user_id_name_lower_key'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(409);
    expect(result!.field).toBe('name');
    expect(result!.message).toMatch(/already have a tag/i);
  });

  it('returns 422 for tag name too short or too long', () => {
    const result = parseDbError(pgErr('23514', 'tags_name_length_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('name');
    expect(result!.message).toMatch(/1 and 50 characters/i);
  });

  it('returns 422 for invalid tag color', () => {
    const result = parseDbError(pgErr('23514', 'tags_color_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('color');
    expect(result!.message).toMatch(/hex color/i);
  });

  it('returns 400 for invalid tag user_id', () => {
    const result = parseDbError(pgErr('23503', 'tags_user_id_fkey'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.field).toBe('user_id');
  });

  // ── subscription_tags ───────────────────────────────────────────

  it('returns 409 for duplicate tag assignment', () => {
    const result = parseDbError(pgErr('23505', 'subscription_tags_pkey'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(409);
    expect(result!.message).toMatch(/already applied/i);
  });

  it('returns 400 for invalid subscription_id', () => {
    const result = parseDbError(pgErr('23503', 'subscription_tags_subscription_id_fkey'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.field).toBe('subscription_id');
  });

  it('returns 400 for invalid tag_id', () => {
    const result = parseDbError(pgErr('23503', 'subscription_tags_tag_id_fkey'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    expect(result!.field).toBe('tag_id');
  });
  // ── gift_card_ledger ─────────────────────────────────────────────

  it('returns 422 for zero amount', () => {
    const result = parseDbError(pgErr('23514', 'gift_card_ledger_amount_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('amount');
    expect(result!.message).toMatch(/not be zero/i);
  });

  it('returns 422 for invalid ledger type', () => {
    const result = parseDbError(pgErr('23514', 'gift_card_ledger_type_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('type');
    expect(result!.message).toMatch(/top_up/i);
  });

  it('returns 422 for mismatched type and amount sign', () => {
    const result = parseDbError(pgErr('23514', 'gift_card_ledger_type_amount_sign_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('amount');
    expect(result!.message).toMatch(/positive amount/i);
  });

  it('returns 422 for invalid currency', () => {
    const result = parseDbError(pgErr('23514', 'gift_card_ledger_currency_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('currency');
    expect(result!.message).toMatch(/3-letter/i);
  });

  it('returns 422 for negative balance', () => {
    const result = parseDbError(pgErr('23514', 'gift_card_ledger_balance_after_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('amount');
    expect(result!.message).toMatch(/negative balance/i);
  });

  it('returns 422 for postings zero amount', () => {
    const result = parseDbError(pgErr('23514', 'gift_card_ledger_postings_amount_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('amount');
    expect(result!.message).toMatch(/not be zero/i);
  });

  it('returns 422 for invalid reason code', () => {
    const result = parseDbError(pgErr('23514', 'gift_card_ledger_transactions_reason_code_check'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.field).toBe('reason_code');
    expect(result!.message).toMatch(/TOP_UP/i);
  });

  it('returns 409 for duplicate transactions reference_id', () => {
    const result = parseDbError(pgErr('23505', 'gift_card_ledger_transactions_reference_idx'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(409);
    expect(result!.field).toBe('reference_id');
    expect(result!.message).toMatch(/duplicate transaction/i);
  });
  // ── generic fallback ─────────────────────────────────────────────

  it('returns 422 with a generic message for an unknown constraint', () => {
    const result = parseDbError(pgErr('23505', 'some_unknown_constraint'));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(422);
    expect(result!.code).toBe('DB_CONSTRAINT_VIOLATION');
    expect(result!.message).toMatch(/already exists/i);
  });

});