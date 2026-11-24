/**
 * Crash-consistency tests for the metering write-ahead log.
 *
 * Covers:
 *  - recovery skips a torn trailing record and keeps every complete one
 *  - randomised SIGKILL during commits never loses an acknowledged commit
 */

import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { WriteAheadLog, type UsageRecord, type UsageStore } from './write-ahead-log';

class MemoryStore implements UsageStore {
  readonly byId = new Map<string, UsageRecord>();

  has(id: string): boolean {
    return this.byId.has(id);
  }

  persist(record: UsageRecord): void {
    this.byId.set(record.id, record);
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'metering-wal-'));
}

describe('WriteAheadLog crash consistency', () => {
  it('recovery skips a torn trailing record and keeps every complete one', async () => {
    const dir = tempDir();
    const path = join(dir, 'usage.wal');
    const store = new MemoryStore();
    const wal = new WriteAheadLog({ path, store, batchSize: Number.MAX_SAFE_INTEGER });

    wal.commit({ n: 0 }, 'ok-0');
    wal.commit({ n: 1 }, 'ok-1');
    // Simulate a crash halfway through the next append (torn trailing line).
    writeFileSync(path, '{"id":"torn","seq":2,"paylo', { flag: 'a' });

    const recoveredStore = new MemoryStore();
    const recovered = new WriteAheadLog({
      path,
      store: recoveredStore,
      batchSize: Number.MAX_SAFE_INTEGER,
    });
    const replayed = await recovered.recover();

    expect(replayed).toBe(2);
    expect(recoveredStore.byId.has('ok-0')).toBe(true);
    expect(recoveredStore.byId.has('ok-1')).toBe(true);
    expect(recoveredStore.byId.has('torn')).toBe(false);
    expect([...recoveredStore.byId.keys()].sort()).toEqual(['ok-0', 'ok-1']);
  });

  it(
    'randomised kill during commits never loses an acknowledged commit (≥200 iterations)',
    async () => {
      const workerPath = fileURLToPath(
        new URL('./write-ahead-log.crash-worker.ts', import.meta.url),
      );
      const iterations = 200;

      for (let n = 0; n < iterations; n++) {
        const dir = tempDir();
        const walPath = join(dir, 'usage.wal');
        const ackPath = join(dir, 'acked.ids');
        writeFileSync(ackPath, '');

        const child: ChildProcess = spawn(process.execPath, [workerPath, walPath, ackPath], {
          stdio: 'ignore',
        });

        // Kill at a random point shortly after start so some commits land.
        const delayMs = 1 + Math.floor(Math.random() * 40);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
          }, delayMs);
          child.on('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        const acked = existsSync(ackPath)
          ? readFileSync(ackPath, 'utf8')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
          : [];

        const store = new MemoryStore();
        const wal = new WriteAheadLog({
          path: walPath,
          store,
          batchSize: Number.MAX_SAFE_INTEGER,
        });
        await wal.recover();

        for (const id of acked) {
          expect(store.byId.has(id), `iteration ${n}: lost acknowledged commit ${id}`).toBe(
            true,
          );
        }
      }
    },
    120_000,
  );
});
