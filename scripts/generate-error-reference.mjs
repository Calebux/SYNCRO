#!/usr/bin/env node
/**
 * Generate error reference MDX from gateway-taxonomy.json.
 * Output: docs/api-reference/errors.mdx (or specified via --out)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAXONOMY_PATH = path.join(ROOT, 'backend', 'src', 'errors', 'gateway-taxonomy.json');
let OUT_PATH = path.join(ROOT, 'docs', 'api-reference', 'errors.mdx');

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--out')) {
    const idx = args.indexOf('--out');
    if (idx + 1 < args.length) {
      OUT_PATH = path.resolve(args[idx + 1]);
    }
  }

  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf8');
  const { errors } = JSON.parse(raw);

  let md = `# Gateway Error Reference\n\n`;
  md += `This page is generated from \`backend/src/errors/gateway-taxonomy.json\`. Do not edit manually.\n\n`;
  md += `| Code | HTTP Status | Cause | Client Remedy |\n`;
  md += `| --- | ---: | --- | --- |\n`;

  for (const err of errors) {
    const code = err.code;
    const status = err.httpStatus;
    const cause = err.defaultMessage.replace(/\|/g, '\|'); // escape pipe for markdown table
    const remedy = err.action.replace(/\|/g, '\|');
    md += `| \`${code}\` | ${status} | ${cause} | ${remedy} |\n`;
  }

  fs.writeFileSync(OUT_PATH, md, 'utf8');
  console.log(`Generated ${OUT_PATH} with ${errors.length} error codes.`);
}

main();
