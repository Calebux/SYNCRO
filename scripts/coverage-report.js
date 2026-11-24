#!/usr/bin/env node
/**
 * Aggregate per-package coverage into one markdown report (issue #1090).
 *
 * Reads each package's `coverage/coverage-summary.json` (Istanbul/v8
 * `json-summary` format), compares it against the configured minimum and,
 * optionally, against a baseline from the target branch, then writes a markdown
 * table for the PR comment.
 *
 * Usage:
 *   node scripts/coverage-report.js                        Print the report
 *   node scripts/coverage-report.js --baseline base.json   Include a delta column
 *   node scripts/coverage-report.js --out report.md        Write to a file
 *   node scripts/coverage-report.js --json out.json        Emit machine-readable totals
 *   node scripts/coverage-report.js --check                Exit 1 if a package is under its minimum
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const THRESHOLDS_FILE = path.join(REPO_ROOT, 'coverage-thresholds.json');
const METRICS = ['lines', 'statements', 'functions', 'branches'];

/** Per-package minimums, the single source of truth for the gate. */
function loadThresholds() {
  return JSON.parse(fs.readFileSync(THRESHOLDS_FILE, 'utf8'));
}

/**
 * Read an Istanbul json-summary. Returns null when the package produced no
 * report (tests skipped, or the package does not run in this job).
 */
function readSummary(packageDir) {
  const file = path.join(REPO_ROOT, packageDir, 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(file)) return null;

  try {
    const total = JSON.parse(fs.readFileSync(file, 'utf8')).total;
    if (!total) return null;

    return Object.fromEntries(
      METRICS.map((metric) => [metric, typeof total[metric]?.pct === 'number' ? total[metric].pct : null]),
    );
  } catch (err) {
    process.stderr.write(`⚠️  Could not read coverage for ${packageDir}: ${err.message}\n`);
    return null;
  }
}

/** Rust coverage is written by cargo-llvm-cov as a plain percentage. */
function readRustSummary(packageDir) {
  const file = path.join(REPO_ROOT, packageDir, 'coverage', 'lines.txt');
  if (!fs.existsSync(file)) return null;

  const pct = parseFloat(fs.readFileSync(file, 'utf8').trim());
  if (Number.isNaN(pct)) return null;

  return { lines: pct, statements: null, functions: null, branches: null };
}

function format(pct) {
  return pct === null || pct === undefined ? '—' : `${pct.toFixed(2)}%`;
}

function formatDelta(current, baseline) {
  if (current === null || baseline === null || baseline === undefined) return '—';
  const delta = current - baseline;
  if (Math.abs(delta) < 0.005) return '±0.00%';
  return `${delta > 0 ? '▲ +' : '▼ '}${delta.toFixed(2)}%`;
}

function collect(thresholds, baseline) {
  return Object.entries(thresholds.packages).map(([name, config]) => {
    const summary = config.type === 'rust' ? readRustSummary(config.dir) : readSummary(config.dir);

    const failures = summary
      ? METRICS.filter(
          (metric) =>
            typeof config.minimum[metric] === 'number' &&
            typeof summary[metric] === 'number' &&
            summary[metric] < config.minimum[metric],
        )
      : [];

    return {
      name,
      dir: config.dir,
      minimum: config.minimum,
      summary,
      failures,
      baseline: baseline?.[name] ?? null,
    };
  });
}

function renderMarkdown(results, { hasBaseline }) {
  const lines = [];

  lines.push('## 📊 Coverage Report');
  lines.push('');

  const header = ['Package', 'Lines', 'Statements', 'Functions', 'Branches', 'Min (lines)', 'Status'];
  if (hasBaseline) header.splice(5, 0, 'Δ Lines');

  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => ' --- ').join('|')}|`);

  for (const result of results) {
    if (!result.summary) {
      const cells = ['—', '—', '—', '—', format(result.minimum.lines), '⚪ not run'];
      if (hasBaseline) cells.splice(4, 0, '—');
      lines.push(`| \`${result.name}\` | ${cells.join(' | ')} |`);
      continue;
    }

    const status = result.failures.length === 0
      ? '✅ pass'
      : `❌ below minimum (${result.failures.join(', ')})`;

    const cells = [
      format(result.summary.lines),
      format(result.summary.statements),
      format(result.summary.functions),
      format(result.summary.branches),
      format(result.minimum.lines),
      status,
    ];

    if (hasBaseline) {
      cells.splice(4, 0, formatDelta(result.summary.lines, result.baseline?.lines ?? null));
    }

    lines.push(`| \`${result.name}\` | ${cells.join(' | ')} |`);
  }

  lines.push('');

  const failing = results.filter((r) => r.failures.length > 0);
  if (failing.length > 0) {
    lines.push('### ❌ Coverage gate failed');
    lines.push('');
    for (const result of failing) {
      for (const metric of result.failures) {
        lines.push(
          `- \`${result.name}\`: ${metric} at **${format(result.summary[metric])}**, ` +
            `minimum is **${format(result.minimum[metric])}**`,
        );
      }
    }
    lines.push('');
    lines.push('Add tests for the code this PR touches, or discuss lowering the minimum in review.');
  } else if (results.some((r) => r.summary)) {
    lines.push('All packages meet their minimum coverage. ✅');
  }

  if (hasBaseline) {
    lines.push('');
    lines.push('<sub>Δ compares against the target branch. Minimums are ratchets — see `coverage-thresholds.json`.</sub>');
  }

  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const argValue = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? null : args[index + 1];
  };

  const thresholds = loadThresholds();

  const baselineFile = argValue('--baseline');
  let baseline = null;
  if (baselineFile && fs.existsSync(baselineFile)) {
    try {
      baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    } catch (err) {
      process.stderr.write(`⚠️  Could not read baseline: ${err.message}\n`);
    }
  }

  const results = collect(thresholds, baseline);
  const markdown = renderMarkdown(results, { hasBaseline: !!baseline });

  const outFile = argValue('--out');
  if (outFile) {
    fs.writeFileSync(outFile, `${markdown}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
  }

  const jsonFile = argValue('--json');
  if (jsonFile) {
    const totals = Object.fromEntries(
      results.filter((r) => r.summary).map((r) => [r.name, r.summary]),
    );
    fs.writeFileSync(jsonFile, `${JSON.stringify(totals, null, 2)}\n`);
  }

  if (args.includes('--check')) {
    const failing = results.filter((r) => r.failures.length > 0);
    if (failing.length > 0) {
      process.stderr.write(
        `\n❌ Coverage gate failed for: ${failing.map((r) => r.name).join(', ')}\n`,
      );
      return 1;
    }
  }

  return 0;
}

process.exit(main());
