/**
 * Maps Postgres database constraint errors to typed HTTP errors.
 *
 * When the database rejects data (e.g. a duplicate tag name, a negative
 * balance), it throws a raw Postgres error. This utility catches those
 * and turns them into clean, friendly responses the frontend can use.
 *
 * Usage:
 *   const appError = parseDbError(error);
 *   if (appError) {
 *     return res.status(appError.status).json({ error: appError.message });
 *   }
 *   throw error; // not a constraint error, let the global handler deal with it
 */

/**
 * The error object we return to the caller.
 *
 * status  - HTTP status code (400, 409, 422)
 * code    - machine-readable name for the error
 * message - human-readable explanation
 * field   - the form field that caused the problem (optional)
 */
export interface AppConstraintError {
  status: number;
  code: string;
  message: string;
  field?: string;
}

/**
 * The shape of a raw Postgres error as returned by Supabase.
 */
interface PostgresError {
  code?: string;        // Postgres error code e.g. "23505"
  constraint?: string;  // Constraint name e.g. "tags_name_length_check"
  message?: string;     // Raw Postgres message
}

// ── Postgres error codes ──────────────────────────────────────────
// These are standard codes that Postgres uses for constraint violations.

const PG_UNIQUE_VIOLATION   = '23505'; // e.g. duplicate tag name
const PG_FK_VIOLATION       = '23503'; // e.g. user_id that doesn't exist
const PG_CHECK_VIOLATION    = '23514'; // e.g. amount is zero
const PG_NOT_NULL_VIOLATION = '23502'; // e.g. name was not provided

// ── Constraint name → error message map ──────────────────────────
// Each key is the exact constraint name from our migration file.
// Each value is the error we return when that constraint is violated.

const CONSTRAINT_MESSAGES: Record<
  string,
  { status: number; message: string; field?: string }
> = {

  // ── tags ───────────────────────────────────────────────────────

  tags_user_id_name_lower_key: {
    status: 409,
    message: 'You already have a tag with this name.',
    field: 'name',
  },
  tags_name_length_check: {
    status: 422,
    message: 'Tag name must be between 1 and 50 characters.',
    field: 'name',
  },
  tags_color_check: {
    status: 422,
    message: 'Tag color must be a valid hex color (e.g. #FF5733 or #F73), or left empty.',
    field: 'color',
  },
  tags_user_id_fkey: {
    status: 400,
    message: 'The referenced user does not exist.',
    field: 'user_id',
  },

  // ── subscription_tags ──────────────────────────────────────────

  subscription_tags_pkey: {
    status: 409,
    message: 'This tag is already applied to this subscription.',
  },
  subscription_tags_subscription_id_fkey: {
    status: 400,
    message: 'The referenced subscription does not exist.',
    field: 'subscription_id',
  },
  subscription_tags_tag_id_fkey: {
    status: 400,
    message: 'The referenced tag does not exist.',
    field: 'tag_id',
  },

  // ── gift_card_ledger ───────────────────────────────────────────

  gift_card_ledger_amount_check: {
    status: 422,
    message: 'Amount must not be zero.',
    field: 'amount',
  },
  gift_card_ledger_postings_amount_check: {
    status: 422,
    message: 'Amount must not be zero.',
    field: 'amount',
  },
  gift_card_ledger_type_check: {
    status: 422,
    message: 'type must be one of: top_up, deduction, refund, adjustment, expiry.',
    field: 'type',
  },
  gift_card_ledger_transactions_reason_code_check: {
    status: 422,
    message: 'reason_code must be one of: PURCHASE, REDEMPTION, EXPIRY, ADJUSTMENT, REVERSAL, TOP_UP, DEDUCTION.',
    field: 'reason_code',
  },
  gift_card_ledger_type_amount_sign_check: {
    status: 422,
    message: 'top_up and refund must have a positive amount. deduction and expiry must have a negative amount.',
    field: 'amount',
  },
  gift_card_ledger_currency_check: {
    status: 422,
    message: 'currency must be a valid 3-letter code (e.g. USD, EUR, GBP).',
    field: 'currency',
  },
  gift_card_ledger_balance_after_check: {
    status: 422,
    message: 'Insufficient gift card balance - this would result in a negative balance.',
    field: 'amount',
  },
  gift_card_ledger_reference_id_user_idx: {
    status: 409,
    message: 'A ledger entry with this reference_id already exists. This looks like a duplicate transaction.',
    field: 'reference_id',
  },
  gift_card_ledger_transactions_reference_idx: {
    status: 409,
    message: 'A ledger entry with this reference_id already exists. This looks like a duplicate transaction.',
    field: 'reference_id',
  },
};

// ── Fallback messages ─────────────────────────────────────────────
// If a constraint fires that isn't in our map above, we still return
// a helpful 4xx error instead of a confusing 500.

const PG_CODE_FALLBACKS: Record<string, string> = {
  [PG_UNIQUE_VIOLATION]:   'A record with these values already exists.',
  [PG_FK_VIOLATION]:       'A referenced record does not exist.',
  [PG_CHECK_VIOLATION]:    'A value failed a database validation rule.',
  [PG_NOT_NULL_VIOLATION]: 'A required field is missing.',
};

// ── Main function ─────────────────────────────────────────────────

/**
 * Tries to parse a raw database error into a typed AppConstraintError.
 *
 * Returns an AppConstraintError if the error is a known constraint violation.
 * Returns null if the error is something else (e.g. network failure) so the
 * caller knows to re-throw it.
 */
export function parseDbError(err: unknown): AppConstraintError | null {
  // Guard: must be a non-null object to be a Postgres error
  if (!err || typeof err !== 'object') return null;

  const pgErr = err as PostgresError;
  const code       = pgErr.code ?? '';
  const constraint = pgErr.constraint ?? '';

  // Only handle the four constraint violation codes we care about
  const isConstraintViolation = [
    PG_UNIQUE_VIOLATION,
    PG_FK_VIOLATION,
    PG_CHECK_VIOLATION,
    PG_NOT_NULL_VIOLATION,
  ].includes(code);

  if (!isConstraintViolation) return null;

  // Step 1: Look up the specific constraint name in our map
  const known = CONSTRAINT_MESSAGES[constraint];
  if (known) {
    return {
      status:  known.status,
      code:    `CONSTRAINT_${constraint.toUpperCase()}`,
      message: known.message,
      field:   known.field,
    };
  }

  // Step 2: Fall back to a generic message if constraint isn't in our map
  return {
    status:  422,
    code:    'DB_CONSTRAINT_VIOLATION',
    message: PG_CODE_FALLBACKS[code] ?? 'A database constraint was violated.',
  };
}
