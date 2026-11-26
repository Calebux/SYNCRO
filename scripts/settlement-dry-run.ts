#!/usr/bin/env node
/** Read-only operator simulation for a prepared settlement batch JSON file. */
import { readFile } from 'node:fs/promises';
import { simulateSettlementBatch, type SettlementDryRunItem } from '../packages/settlement/src/dry-run';

const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: npx tsx scripts/settlement-dry-run.ts <batch.json>');
  process.exitCode = 2;
} else {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('input must be a JSON array of settlement candidates');
    const items = parsed.map((value) => {
      if (!value || typeof value !== 'object') throw new Error('each candidate must be an object');
      const row = value as Record<string, unknown>;
      for (const field of ['amount', 'capacity', 'settled', 'feeBase', 'feePerOperation']) {
        if (typeof row[field] !== 'string' || !/^\d+$/.test(row[field] as string)) {
          throw new Error(`${field} must be a non-negative integer string`);
        }
      }
      if (typeof row.channelId !== 'string') throw new Error('channelId must be a string');
      for (const field of ['nonce', 'expectedNonce', 'operationCount']) {
        if (!Number.isSafeInteger(row[field]) || (row[field] as number) < 0) {
          throw new Error(`${field} must be a non-negative safe integer`);
        }
      }
      return {
        ...row,
        amount: BigInt(row.amount as string),
        capacity: BigInt(row.capacity as string),
        settled: BigInt(row.settled as string),
        feeBase: BigInt(row.feeBase as string),
        feePerOperation: BigInt(row.feePerOperation as string),
      } as SettlementDryRunItem;
    });
    process.stdout.write(`${JSON.stringify(simulateSettlementBatch(items), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
