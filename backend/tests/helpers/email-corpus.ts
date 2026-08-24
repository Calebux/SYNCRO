/**
 * Golden-corpus loader and scoring harness for subscription email parsing
 * (issue #1280).
 *
 * The corpus is the ground truth: each case records what a human says the
 * email means, not what the parser currently produces. The harness scores the
 * parser against that truth and the result is compared to a committed
 * baseline, so any change in precision, recall or per-field accuracy shows up
 * as a diff rather than going unnoticed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSubscriptionEmail } from '../../src/services/email-parser';

// ─── Corpus types ────────────────────────────────────────────────────────────

/** The four fields the parser is expected to extract. */
export interface ExpectedSubscription {
  name: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
}

export interface CorpusCase {
  id: string;
  merchant: string;
  /** ISO 639-1 language code of the email body. */
  locale: string;
  /** `positive` = a real subscription email; `negative` = it is not one. */
  kind: 'positive' | 'negative';
  notes: string;
  email: { subject: string; from: string; body: string };
  /** Ground truth for positives; `null` for negatives. */
  expected: ExpectedSubscription | null;
}

// ─── Report types ────────────────────────────────────────────────────────────

export interface DetectionMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface FieldMetric {
  correct: number;
  total: number;
  accuracy: number;
}

export type FieldName = 'name' | 'amount' | 'currency' | 'interval';

export interface GroupMetric {
  cases: number;
  detected: number;
  fieldsCorrect: number;
  fieldsTotal: number;
  accuracy: number;
}

export interface CorpusReport {
  totals: { cases: number; positive: number; negative: number };
  detection: DetectionMetrics;
  fields: Record<FieldName, FieldMetric>;
  /** Every field of every detected positive, aggregated. */
  overallFieldAccuracy: number;
  byLocale: Record<string, GroupMetric>;
  byMerchant: Record<string, GroupMetric>;
  /** Cases that did not score perfectly, for the CI job summary. */
  failures: CaseFailure[];
}

export interface CaseFailure {
  id: string;
  merchant: string;
  locale: string;
  reason: 'missed' | 'false-positive' | 'field-mismatch';
  details: string;
}

export const FIELD_NAMES: readonly FieldName[] = ['name', 'amount', 'currency', 'interval'];

export const CORPUS_DIR = path.join(__dirname, '..', 'fixtures', 'email-corpus');
export const CASES_DIR = path.join(CORPUS_DIR, 'cases');
export const BASELINE_PATH = path.join(CORPUS_DIR, 'baseline.json');

// ─── Loading ─────────────────────────────────────────────────────────────────

/** Read every case file, sorted by id so runs are deterministic. */
export function loadCorpus(): CorpusCase[] {
  const files = fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  return files.map((file) => {
    const raw = fs.readFileSync(path.join(CASES_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as CorpusCase;

    if (parsed.id !== path.basename(file, '.json')) {
      throw new Error(`Corpus case ${file} has mismatched id "${parsed.id}"`);
    }
    if (parsed.kind === 'positive' && !parsed.expected) {
      throw new Error(`Corpus case ${parsed.id} is positive but has no expected result`);
    }
    if (parsed.kind === 'negative' && parsed.expected) {
      throw new Error(`Corpus case ${parsed.id} is negative but carries an expected result`);
    }
    return parsed;
  });
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : round(numerator / denominator);
}

function emptyGroup(): GroupMetric {
  return { cases: 0, detected: 0, fieldsCorrect: 0, fieldsTotal: 0, accuracy: 0 };
}

/**
 * Run the deterministic parser over the corpus and score it.
 *
 * Only `parseSubscriptionEmail` is exercised — never the LLM fallback — so the
 * harness is offline, free and reproducible.
 */
export function evaluateCorpus(cases: CorpusCase[] = loadCorpus()): CorpusReport {
  const detection: DetectionMetrics = {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    trueNegatives: 0,
    precision: 0,
    recall: 0,
    f1: 0,
  };

  const fields: Record<FieldName, FieldMetric> = {
    name: { correct: 0, total: 0, accuracy: 0 },
    amount: { correct: 0, total: 0, accuracy: 0 },
    currency: { correct: 0, total: 0, accuracy: 0 },
    interval: { correct: 0, total: 0, accuracy: 0 },
  };

  const byLocale: Record<string, GroupMetric> = {};
  const byMerchant: Record<string, GroupMetric> = {};
  const failures: CaseFailure[] = [];

  for (const testCase of cases) {
    const locale = (byLocale[testCase.locale] ??= emptyGroup());
    const merchant = (byMerchant[testCase.merchant] ??= emptyGroup());
    locale.cases++;
    merchant.cases++;

    const actual = parseSubscriptionEmail(testCase.email);
    const detected = actual !== null;

    if (testCase.kind === 'negative') {
      if (detected) {
        detection.falsePositives++;
        failures.push({
          id: testCase.id,
          merchant: testCase.merchant,
          locale: testCase.locale,
          reason: 'false-positive',
          details: `parsed as a subscription (name=${JSON.stringify(actual!.name)}, amount=${actual!.amount})`,
        });
      } else {
        detection.trueNegatives++;
      }
      continue;
    }

    // Positive case from here on.
    if (!detected) {
      detection.falseNegatives++;
      failures.push({
        id: testCase.id,
        merchant: testCase.merchant,
        locale: testCase.locale,
        reason: 'missed',
        details: 'parser returned null for a real subscription email',
      });
      continue;
    }

    detection.truePositives++;
    locale.detected++;
    merchant.detected++;

    const expected = testCase.expected!;
    const mismatches: string[] = [];

    for (const field of FIELD_NAMES) {
      fields[field].total++;
      locale.fieldsTotal++;
      merchant.fieldsTotal++;

      const expectedValue = expected[field];
      const actualValue = actual![field];

      if (actualValue === expectedValue) {
        fields[field].correct++;
        locale.fieldsCorrect++;
        merchant.fieldsCorrect++;
      } else {
        mismatches.push(
          `${field}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
        );
      }
    }

    if (mismatches.length > 0) {
      failures.push({
        id: testCase.id,
        merchant: testCase.merchant,
        locale: testCase.locale,
        reason: 'field-mismatch',
        details: mismatches.join('; '),
      });
    }
  }

  detection.precision = safeRatio(
    detection.truePositives,
    detection.truePositives + detection.falsePositives,
  );
  detection.recall = safeRatio(
    detection.truePositives,
    detection.truePositives + detection.falseNegatives,
  );
  detection.f1 =
    detection.precision + detection.recall === 0
      ? 0
      : round((2 * detection.precision * detection.recall) / (detection.precision + detection.recall));

  for (const field of FIELD_NAMES) {
    fields[field].accuracy = safeRatio(fields[field].correct, fields[field].total);
  }

  for (const group of [...Object.values(byLocale), ...Object.values(byMerchant)]) {
    group.accuracy = safeRatio(group.fieldsCorrect, group.fieldsTotal);
  }

  const fieldsCorrect = FIELD_NAMES.reduce((sum, f) => sum + fields[f].correct, 0);
  const fieldsTotal = FIELD_NAMES.reduce((sum, f) => sum + fields[f].total, 0);

  return {
    totals: {
      cases: cases.length,
      positive: cases.filter((c) => c.kind === 'positive').length,
      negative: cases.filter((c) => c.kind === 'negative').length,
    },
    detection,
    fields,
    overallFieldAccuracy: safeRatio(fieldsCorrect, fieldsTotal),
    byLocale,
    byMerchant,
    failures,
  };
}

// ─── Baseline ────────────────────────────────────────────────────────────────

/** The subset of the report that CI gates on. */
export interface CorpusBaseline {
  note: string;
  totals: { cases: number; positive: number; negative: number };
  detection: { precision: number; recall: number; f1: number };
  fields: Record<FieldName, number>;
  overallFieldAccuracy: number;
}

export function readBaseline(): CorpusBaseline {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as CorpusBaseline;
}

export function toBaseline(report: CorpusReport, note: string): CorpusBaseline {
  return {
    note,
    totals: report.totals,
    detection: {
      precision: report.detection.precision,
      recall: report.detection.recall,
      f1: report.detection.f1,
    },
    fields: {
      name: report.fields.name.accuracy,
      amount: report.fields.amount.accuracy,
      currency: report.fields.currency.accuracy,
      interval: report.fields.interval.accuracy,
    },
    overallFieldAccuracy: report.overallFieldAccuracy,
  };
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Field accuracy is undefined when nothing in the group was detected. */
function groupAccuracy(metric: GroupMetric): string {
  return metric.fieldsTotal === 0 ? 'n/a' : pct(metric.accuracy);
}

function delta(current: number, base: number): string {
  const diff = round(current - base);
  if (diff === 0) return '—';
  return `${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)} pp`;
}

/** Render the report as GitHub-flavoured Markdown for the CI job summary. */
export function formatMarkdownReport(report: CorpusReport, baseline: CorpusBaseline): string {
  const lines: string[] = [];

  lines.push('## Email parsing accuracy');
  lines.push('');
  lines.push(
    `Corpus: **${report.totals.cases} cases** (${report.totals.positive} positive, ${report.totals.negative} negative)`,
  );
  lines.push('');
  lines.push('| Metric | Baseline | Current | Δ |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(
    `| Precision | ${pct(baseline.detection.precision)} | ${pct(report.detection.precision)} | ${delta(report.detection.precision, baseline.detection.precision)} |`,
  );
  lines.push(
    `| Recall | ${pct(baseline.detection.recall)} | ${pct(report.detection.recall)} | ${delta(report.detection.recall, baseline.detection.recall)} |`,
  );
  lines.push(
    `| F1 | ${pct(baseline.detection.f1)} | ${pct(report.detection.f1)} | ${delta(report.detection.f1, baseline.detection.f1)} |`,
  );
  for (const field of FIELD_NAMES) {
    lines.push(
      `| Field: ${field} | ${pct(baseline.fields[field])} | ${pct(report.fields[field].accuracy)} | ${delta(report.fields[field].accuracy, baseline.fields[field])} |`,
    );
  }
  lines.push(
    `| All fields | ${pct(baseline.overallFieldAccuracy)} | ${pct(report.overallFieldAccuracy)} | ${delta(report.overallFieldAccuracy, baseline.overallFieldAccuracy)} |`,
  );

  lines.push('');
  lines.push('### By locale');
  lines.push('');
  lines.push('| Locale | Cases | Detected | Field accuracy |');
  lines.push('| --- | --- | --- | --- |');
  for (const [locale, metric] of Object.entries(report.byLocale).sort()) {
    lines.push(`| ${locale} | ${metric.cases} | ${metric.detected} | ${groupAccuracy(metric)} |`);
  }

  lines.push('');
  lines.push('### By merchant');
  lines.push('');
  lines.push('| Merchant | Cases | Detected | Field accuracy |');
  lines.push('| --- | --- | --- | --- |');
  for (const [merchant, metric] of Object.entries(report.byMerchant).sort()) {
    lines.push(`| ${merchant} | ${metric.cases} | ${metric.detected} | ${groupAccuracy(metric)} |`);
  }

  if (report.failures.length > 0) {
    lines.push('');
    lines.push(`### Known gaps (${report.failures.length})`);
    lines.push('');
    lines.push('| Case | Locale | Reason | Details |');
    lines.push('| --- | --- | --- | --- |');
    for (const failure of report.failures) {
      lines.push(
        `| \`${failure.id}\` | ${failure.locale} | ${failure.reason} | ${failure.details.replace(/\|/g, '\\|')} |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Append the report to the GitHub Actions job summary when running in CI. */
export function publishJobSummary(markdown: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${markdown}\n`);
}
