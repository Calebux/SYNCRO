/**
 * CSV Import Service
 *
 * Parses, validates and imports subscriptions from a CSV buffer.
 * Follows a two-step flow:
 *   1. preview() — validate without saving, detect duplicates
 *   2. commit()  — bulk-insert only the valid, non-duplicate rows
 */

import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { supabase } from '../config/database';
import logger from '../config/logger';

// ─── Types ────────────────────────────────────────────────────────────────

export type ImportRowStatus = 'valid' | 'duplicate' | 'error';

export interface ImportRow {
  row: number;
  status: ImportRowStatus;
  data: ParsedRow | null;
  error?: string;
  duplicateId?: string; // existing subscription id if duplicate
}

export interface ImportPreview {
  rows: ImportRow[];
  validCount: number;
  duplicateCount: number;
  errorCount: number;
}

export interface CommitResult {
  imported: number;
  skipped: number;   // duplicates the user chose to skip
  errors: number;
}

interface ParsedRow {
  name: string;
  price: number;
  currency: string;
  billing_cycle: string;
  next_renewal: string | null;
  category: string;
  renewal_url: string | null;
}

// ─── Validation ───────────────────────────────────────────────────────────

const VALID_BILLING_CYCLES = ['monthly', 'yearly', 'quarterly', 'weekly', 'lifetime'] as const;

const safeUrlOrEmpty = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => {
    if (!v) return true;
    try {
      const url = new URL(v);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be a valid http/https URL or empty')
  .nullable()
  .optional();

const rowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  price: z
    .string()
    .transform((v) => parseFloat(v.replace(/[$,]/g, '')))
    .refine((v) => !isNaN(v) && v >= 0, 'Price must be a non-negative number'),
  currency: z.string().length(3, 'Currency must be a 3-letter code (e.g. USD)').default('USD'),
  billing_cycle: z
    .string()
    .transform((v) => v.toLowerCase().trim())
    .refine(
      (v) => (VALID_BILLING_CYCLES as readonly string[]).includes(v),
      `Billing cycle must be one of: ${VALID_BILLING_CYCLES.join(', ')}`,
    ),
  next_renewal: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null))
    .refine(
      (v) => !v || !isNaN(Date.parse(v)),
      'next_renewal must be a valid date (YYYY-MM-DD)',
    ),
  category: z.string().default('Other'),
  renewal_url: safeUrlOrEmpty,
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function validateRow(raw: Record<string, string>, rowNum: number): ImportRow {
  // Normalize keys: strip BOM, lowercase, trim
  const normalised: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    normalised[k.replace(/^\uFEFF/, '').toLowerCase().trim()] = String(v ?? '').trim();
  }

  const result = rowSchema.safeParse(normalised);

  if (!result.success) {
    const msg = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return { row: rowNum, status: 'error', data: null, error: msg };
  }

  return {
    row: rowNum,
    status: 'valid',
    data: result.data as ParsedRow,
  };
}

async function findDuplicate(name: string, userId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', name)
    .maybeSingle();

  return data?.id;
}

function renewsInDays(nextRenewal: string | null): number {
  if (!nextRenewal) return 30;
  const ms = Date.parse(nextRenewal) - Date.now();
  return Math.max(0, Math.round(ms / 86_400_000));
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function previewImport(
  buffer: Buffer,
  userId: string,
): Promise<ImportPreview> {
  let records: Record<string, string>[];

  try {
    records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new Error(`CSV parse error: ${(err as Error).message}`);
  }

  if (records.length === 0) {
    throw new Error('The CSV file is empty or has no data rows.');
  }

  if (records.length > 500) {
    throw new Error(`File contains ${records.length} rows — limit is 500 per import.`);
  }

  const rows: ImportRow[] = [];

  for (let i = 0; i < records.length; i++) {
    const rowNum = i + 2; // +2 because row 1 = header
    const validated = validateRow(records[i], rowNum);

    if (validated.status === 'valid' && validated.data) {
      const dupId = await findDuplicate(validated.data.name, userId);
      if (dupId) {
        rows.push({ ...validated, status: 'duplicate', duplicateId: dupId });
        continue;
      }
    }

    rows.push(validated);
  }

  return {
    rows,
    validCount: rows.filter((r) => r.status === 'valid').length,
    duplicateCount: rows.filter((r) => r.status === 'duplicate').length,
    errorCount: rows.filter((r) => r.status === 'error').length,
  };
}

/**
 * Commit a previewed import.
 *
 * @param rows      The rows from previewImport()
 * @param userId    Authenticated user ID
 * @param skipDupes Whether to skip duplicates (true) or import them anyway (false)
 */
export async function commitImport(
  rows: ImportRow[],
  userId: string,
  skipDupes = true,
): Promise<CommitResult> {
  const toInsert = rows.filter(
    (r) => r.status === 'valid' || (!skipDupes && r.status === 'duplicate'),
  );

  const skipped = skipDupes ? rows.filter((r) => r.status === 'duplicate').length : 0;
  const errors = rows.filter((r) => r.status === 'error').length;

  if (toInsert.length === 0) {
    return { imported: 0, skipped, errors };
  }

  const insertPayload = toInsert
    .filter((r): r is ImportRow & { data: ParsedRow } => r.data !== null)
    .map((r) => ({
      user_id: userId,
      name: r.data.name,
      price: r.data.price,
      currency: r.data.currency,
      billing_cycle: r.data.billing_cycle,
      renews_in: renewsInDays(r.data.next_renewal),
      category: r.data.category,
      renewal_url: r.data.renewal_url || null,
      status: 'active',
      source: 'csv_import',
      date_added: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

  const { error } = await supabase.from('subscriptions').insert(insertPayload);

  if (error) {
    logger.error('CSV import DB error:', error);
    throw new Error(`Import failed: ${error.message}`);
  }

  return { imported: insertPayload.length, skipped, errors };
}

/** CSV template content for users to download. */
export const CSV_TEMPLATE =
  'name,price,currency,billing_cycle,next_renewal,category,renewal_url\n' +
  'Netflix,17.99,USD,monthly,2025-04-15,Streaming,https://netflix.com\n' +
  'Adobe Creative Cloud,54.99,USD,monthly,2025-04-22,Design,https://adobe.com\n';
