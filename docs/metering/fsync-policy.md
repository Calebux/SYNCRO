# Metering Write-Ahead Log fsync Policy

Committed usage must survive a process crash (`kill -9`) and a host power loss
between `commit()` returning and the primary store catching up. The write-ahead
log (WAL) is the source of truth for that window. This document states exactly
when the metering package calls `fsync` and what that call guarantees.

Implementation: `packages/metering/src/write-ahead-log.ts` (append path) and
`packages/metering/src/recovery.ts` (durable commit / replay contract).

## 1. What is durable when `commit()` returns

At the moment `WriteAheadLog.commit()` (or `DurableMeter.flush()` after a
batched append) returns:

| Durable | Not yet durable |
|---|---|
| The usage record is in the WAL file on stable storage | The record may not be in the primary store |
| A crash loses no acknowledged commit | Receipts / projections derived from the store may lag |

The primary store is a replayable projection. Restart runs `recover()`, which
re-applies every complete WAL record and deduplicates by record id.

## 2. fsync points

### Append (commit barrier)

Each durable append opens the WAL, writes one newline-delimited JSON record
with a single `write(2)`, then `fsync`s the file descriptor before the append
helper returns. `commit()` does not return until that fsync completes.

That fsync is the only barrier that makes an acknowledged commit crash-safe.
Buffering in the page cache is not enough for power loss.

### Truncate (after successful replay)

After `recover()` has applied every complete record, the WAL is replaced with
an empty file:

1. Create a temporary empty file and `fsync` it.
2. `rename` the temporary file over the WAL path.
3. `fsync` the parent directory so the rename is durable.

Without the directory fsync, a crash immediately after rename can leave the
old WAL visible again after reboot on some filesystems.

### Implementations of the `WriteAheadLog` interface

`recovery.ts` defines an abstract `WriteAheadLog` whose `append` **must**
fsync before resolving. File-backed implementations follow the append policy
above. In-memory test doubles may omit fsync; they are not a durability
claim.

## 3. Torn trailing records

The WAL is newline-delimited JSON. A crash mid-`write` can leave a partial
last line. On recovery:

- Every complete line is parsed and applied (or skipped if already persisted).
- The first unparseable line ends replay; that torn trailing record is dropped.
- Complete records before the tear are kept. Append-only writers never place a
  complete record after a torn one, so stopping at the first bad line is safe.

An acknowledged commit cannot be the torn line: acknowledgement happens only
after `commit()` returns, which is after fsync of a complete record.

## 4. What callers must not assume

- `commit()` does not wait for primary-store persistence.
- `flush()` / projection updates are not a second durability barrier for usage
  that is already in the WAL.
- Throughput of the durable path is bounded by fsync latency (see
  `measureThroughput` / `measureDurableThroughput`), not by the primary store.

## 5. Verification

Crash-consistency tests in `packages/metering/src/write-ahead-log.crash.test.ts`:

- Inject a torn trailing line and assert recovery keeps every complete record.
- Spawn a child that commits in a loop, `SIGKILL` it at random points over
  ≥200 iterations, and assert every id acknowledged after `commit()` returns
  is present after `recover()`.
