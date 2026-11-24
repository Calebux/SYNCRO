/**
 * Regenerate the committed accuracy baseline for the email golden corpus
 * (issue #1280).
 *
 * Run this only when parser accuracy has genuinely improved, or when cases are
 * added to the corpus, and commit the result alongside the change that caused
 * it:
 *
 *   npx ts-node backend/scripts/update-email-corpus-baseline.ts
 */

import fs from 'node:fs';
import {
  evaluateCorpus,
  formatMarkdownReport,
  toBaseline,
  readBaseline,
  BASELINE_PATH,
} from '../tests/helpers/email-corpus';

const report = evaluateCorpus();
const baseline = toBaseline(
  report,
  'Measured floor, not a target. Regenerate with backend/scripts/update-email-corpus-baseline.ts.',
);

let previous: ReturnType<typeof readBaseline> | null = null;
try {
  previous = readBaseline();
} catch {
  previous = null;
}

fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);

console.log(formatMarkdownReport(report, previous ?? baseline));
console.log(`\nBaseline written to ${BASELINE_PATH}`);
