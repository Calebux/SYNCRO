/**
 * Child process for WAL crash-injection tests.
 *
 * Commits records in a tight loop. After each `commit()` returns, appends the
 * record id to the ack file and fsyncs it. The parent may SIGKILL this process
 * at any point; only ids present in the ack file are treated as acknowledged.
 *
 * Usage: node write-ahead-log.crash-worker.ts <walPath> <ackPath>
 */

import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { WriteAheadLog, type UsageStore } from "./write-ahead-log.ts";

class MemoryStore implements UsageStore {
  readonly ids = new Set<string>();

  has(id: string): boolean {
    return this.ids.has(id);
  }

  persist(record: { id: string }): void {
    this.ids.add(record.id);
  }
}

function appendAck(ackPath: string, id: string): void {
  const fd = openSync(ackPath, "a");
  try {
    writeSync(fd, `${id}\n`, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

const walPath = process.argv[2];
const ackPath = process.argv[3];
if (!walPath || !ackPath) {
  console.error("usage: write-ahead-log.crash-worker.ts <walPath> <ackPath>");
  process.exit(2);
}

const wal = new WriteAheadLog({ path: walPath, store: new MemoryStore(), batchSize: Number.MAX_SAFE_INTEGER });

let i = 0;
for (;;) {
  const id = `c-${i}`;
  wal.commit({ n: i }, id);
  appendAck(ackPath, id);
  i++;
}
