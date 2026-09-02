#!/usr/bin/env node
/**
 * Write Turbo cache hit rate to stdout and GitHub job summary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_DIR = path.join(ROOT, '.turbo', 'runs');

function latestRun() {
  if (!fs.existsSync(RUNS_DIR)) return null;
  const files = fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(RUNS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, files[0].name), 'utf8'));
}

function main() {
  const run = latestRun();
  if (!run) {
    const msg = 'No Turbo run summary found (.turbo/runs). Cache hit rate: n/a';
    console.log(msg);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Turbo cache\n\n${msg}\n`);
    }
    return;
  }

  const tasks = Object.values(run.tasks || run.execution?.tasks || {});
  const list = Array.isArray(tasks) ? tasks : Object.values(tasks);
  const flattened = list.length
    ? list
    : Array.isArray(run.tasks) ? run.tasks : [];

  let hits = 0;
  let total = 0;
  const rows = [];
  for (const task of flattened) {
    const name = task.taskId || task.id || `${task.package ?? ''}#${task.task ?? ''}`;
    const cache = task.cache || {};
    const status =
      cache.status ||
      (task.cache?.local ? 'HIT' : undefined) ||
      (typeof task.cache === 'string' ? task.cache : 'MISS');
    const hit = String(status).toUpperCase().includes('HIT');
    if (name) {
      total += 1;
      if (hit) hits += 1;
      rows.push(`| ${name} | ${hit ? 'HIT' : 'MISS'} |`);
    }
  }

  const rate = total === 0 ? 0 : Math.round((hits / total) * 100);
  const body = [
    `Turbo cache hit rate: ${hits}/${total} (${rate}%)`,
    '',
    '| Task | Cache |',
    '| --- | --- |',
    ...rows,
  ].join('\n');

  console.log(body);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Turbo cache\n\n${body}\n\nBaseline: unconditional \`npm run typecheck --workspaces\` (all four packages every PR). After: affected-only on PRs, full graph on main, remote cache enabled.\n`,
    );
  }
}

main();
