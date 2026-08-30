/**
 * Regression gate for subscription email parsing accuracy (issue #1280).
 *
 * Scores the deterministic parser against the committed golden corpus and
 * fails if any metric drops below the recorded baseline. Improvements are
 * always allowed — when one lands, regenerate the baseline with:
 *
 *   npx ts-node backend/scripts/update-email-corpus-baseline.ts
 */

import {
  evaluateCorpus,
  formatMarkdownReport,
  publishJobSummary,
  readBaseline,
  FIELD_NAMES,
  type CorpusReport,
  type CorpusBaseline,
} from './helpers/email-corpus';

describe('email parsing accuracy vs. golden corpus', () => {
  let report: CorpusReport;
  let baseline: CorpusBaseline;

  beforeAll(() => {
    report = evaluateCorpus();
    baseline = readBaseline();

    const markdown = formatMarkdownReport(report, baseline);
    publishJobSummary(markdown);
    if (process.env.VERBOSE) console.log(markdown);
  });

  it('still covers at least as many cases as the baseline', () => {
    expect(report.totals.cases).toBeGreaterThanOrEqual(baseline.totals.cases);
    expect(report.totals.positive).toBeGreaterThanOrEqual(baseline.totals.positive);
    expect(report.totals.negative).toBeGreaterThanOrEqual(baseline.totals.negative);
  });

  it('does not regress on precision', () => {
    expect(report.detection.precision).toBeGreaterThanOrEqual(baseline.detection.precision);
  });

  it('does not regress on recall', () => {
    expect(report.detection.recall).toBeGreaterThanOrEqual(baseline.detection.recall);
  });

  it('does not regress on F1', () => {
    expect(report.detection.f1).toBeGreaterThanOrEqual(baseline.detection.f1);
  });

  it.each(FIELD_NAMES)('does not regress on %s accuracy', (field) => {
    expect(report.fields[field].accuracy).toBeGreaterThanOrEqual(baseline.fields[field]);
  });

  it('does not regress on overall field accuracy', () => {
    expect(report.overallFieldAccuracy).toBeGreaterThanOrEqual(baseline.overallFieldAccuracy);
  });

  it('reports a per-field breakdown for every extracted field', () => {
    for (const field of FIELD_NAMES) {
      expect(report.fields[field].total).toBe(report.detection.truePositives);
    }
  });

  it('covers every Phase 1 merchant', () => {
    // README "Supported Subscriptions (Phase 1)".
    const phase1 = ['Netflix', 'Spotify', 'Amazon Prime', 'Audible', 'YouTube Premium', 'Steam'];
    for (const merchant of phase1) {
      expect(Object.keys(report.byMerchant)).toContain(merchant);
    }
  });

  it('covers more than one language', () => {
    expect(Object.keys(report.byLocale).length).toBeGreaterThan(1);
  });

  it('includes ambiguous negatives, not just obvious ones', () => {
    expect(report.totals.negative).toBeGreaterThanOrEqual(10);
  });
});
