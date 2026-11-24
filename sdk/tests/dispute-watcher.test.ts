/**
 * Integration tests for the consumer-side dispute watcher (issue #1796).
 *
 * Acceptance criterion:
 *   "An integration test performs a stale close, and the watcher wins the
 *    dispute inside the challenge period."
 *
 * Additional coverage:
 *  - Watcher is a no-op while the channel is open
 *  - Watcher skips when the consumer has no state for the channel
 *  - Watcher skips when the on-chain nonce is already the newest
 *  - Watcher fires onDeadlineApproaching when time is running out
 *  - Watcher does NOT re-submit after already winning the dispute
 *  - Watcher keeps running after a failed dispute attempt, then wins on retry
 *  - Multiple channels watched — only the stale one is disputed
 *  - WatchHandle.stop() ends the loop; WatchHandle.stopped resolves
 *  - ValidationError on bad options (missing contractId, caller, store, etc.)
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  watchChannels,
  type ChannelStateStore,
  type DisputeSigner,
  type SignedChannelState,
  type WatchChannelsOptions,
  type DisputeSubmittedEvent,
  type DeadlineApproachingEvent,
  type DisputeErrorEvent,
} from "../src/channels/watcher.js";
import type { ChannelInvocation, ChannelTransport } from "../src/channels/client.js";
import { ValidationError } from "../src/errors.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface StoredChannel {
  id: bigint;
  depositor: string;
  counterparty: string;
  token: string;
  balance_a: bigint;
  balance_b: bigint;
  sequence: bigint;
  state: "open" | "closing" | "dispute" | "closed";
  dispute_deadline: bigint;
  closing_started_at: bigint;
}

/**
 * In-memory channel chain that the watcher drives.
 * Supports `initiate_close` (counterparty action) and `dispute` (consumer action).
 */
class MemoryChain implements ChannelTransport {
  readonly invocations: ChannelInvocation[] = [];
  private channels = new Map<string, StoredChannel>();
  private nextId = 1n;

  constructor(private readonly nowSec: () => bigint) {}

  /** Pre-populate an open channel without going through open_channel. */
  seed(channel: StoredChannel): void {
    this.channels.set(channel.id.toString(), { ...channel });
  }

  /** Counterparty initiates a unilateral close at sequence `seq`. */
  staleClose(channelId: bigint, seq: bigint, deadline: bigint): void {
    const ch = this.requireChannel(channelId);
    ch.sequence = seq;
    ch.state = "closing";
    ch.dispute_deadline = deadline;
    ch.closing_started_at = this.nowSec();
  }

  async invoke(call: ChannelInvocation): Promise<unknown> {
    this.invocations.push(call);
    if (call.method === "dispute") {
      const id = call.args["channel_id"] as bigint;
      const ch = this.requireChannel(id);
      if (this.nowSec() > ch.dispute_deadline) {
        throw new Error("dispute: challenge window expired");
      }
      ch.sequence        = call.args["seq"] as bigint;
      ch.balance_a       = call.args["balance_a"] as bigint;
      ch.balance_b       = call.args["balance_b"] as bigint;
      ch.state           = "dispute";
      return null;
    }
    throw new Error(`MemoryChain.invoke: unexpected method ${call.method}`);
  }

  async read(call: ChannelInvocation): Promise<unknown> {
    if (call.method !== "get_channel") {
      throw new Error(`MemoryChain.read: unexpected method ${call.method}`);
    }
    const id = call.args["channel_id"] as bigint;
    const ch = this.channels.get(id.toString());
    return ch ? { ...ch } : null;
  }

  getChannel(channelId: bigint): StoredChannel | undefined {
    return this.channels.get(channelId.toString());
  }

  private requireChannel(channelId: bigint): StoredChannel {
    const ch = this.channels.get(channelId.toString());
    if (!ch) throw new Error(`channel ${channelId} not found`);
    return ch;
  }
}

/** Simple in-memory state store. */
class MemoryStore implements ChannelStateStore {
  private states = new Map<string, SignedChannelState>();

  set(state: SignedChannelState): void {
    this.states.set(state.channelId.toString(), state);
  }

  getLatest(channelId: bigint): SignedChannelState | null {
    return this.states.get(channelId.toString()) ?? null;
  }
}

/** Passthrough signer that echoes the stored signature or returns a stub. */
const noopSigner: DisputeSigner = {
  sign: (state) => state.signature || "stub-sig",
};

/** Advance the watcher by ticking `n` poll cycles. */
async function tickN(n: number, ticks: Array<() => void>): Promise<void> {
  for (let i = 0; i < n; i++) {
    if (ticks[i]) ticks[i]();
    // yield to microtask queue so the watcher's async loop can run
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

/**
 * Build a watcher with tick-controlled sleep so tests don't need real timers.
 */
function buildWatcher(
  overrides: Partial<WatchChannelsOptions> & Pick<WatchChannelsOptions, "channelIds" | "store" | "transport">,
): { ticks: Array<() => void>; options: WatchChannelsOptions } {
  const ticks: Array<() => void> = [];

  const sleep = (_ms: number): Promise<void> =>
    new Promise((resolve) => {
      ticks.push(resolve);
    });

  const options: WatchChannelsOptions = {
    contractId: "CCHANNEL",
    caller: "GCONSUMER",
    signer: noopSigner,
    pollIntervalMs: 999_999, // effectively disabled — controlled by sleep stub
    sleep,
    now: () => Date.now(),
    ...overrides,
  };

  return { ticks, options };
}

// ─── Acceptance criterion ────────────────────────────────────────────────────

describe("dispute watcher — acceptance criterion", () => {
  it("performs a stale close and the watcher wins the dispute inside the challenge period", async () => {
    let nowMs = 1_700_000_000_000;
    const nowSec = () => BigInt(Math.floor(nowMs / 1000));

    const chain = new MemoryChain(nowSec);
    const store = new MemoryStore();

    const channelId = 1n;
    const disputeDeadline = nowSec() + 3600n; // 1 hour from now

    // Open channel at sequence 5 (consumer's latest signed state)
    chain.seed({
      id: channelId,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 60n,
      balance_b: 40n,
      sequence: 5n,
      state: "open",
      dispute_deadline: disputeDeadline,
      closing_started_at: 0n,
    });

    // Consumer's store has sequence 5
    store.set({
      channelId,
      sequence: 5n,
      balanceA: 60n,
      balanceB: 40n,
      signature: "consumer-sig-seq5",
    });

    // Counterparty submits a stale close at sequence 3
    chain.staleClose(channelId, 3n, disputeDeadline);

    const disputedEvents: DisputeSubmittedEvent[] = [];

    const { ticks, options } = buildWatcher({
      channelIds: [channelId],
      store,
      transport: chain,
      now: () => nowMs,
      onDisputeSubmitted: (ev) => { disputedEvents.push(ev); },
    });

    const handle = watchChannels(options);

    // Run one poll tick
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    handle.stop();
    ticks.forEach((t) => t()); // unblock any pending sleeps
    await handle.stopped;

    // The watcher must have called dispute
    const disputeCalls = chain.invocations.filter((c) => c.method === "dispute");
    expect(disputeCalls).toHaveLength(1);
    expect(disputeCalls[0]!.args["seq"]).toBe(5n);
    expect(disputeCalls[0]!.args["balance_a"]).toBe(60n);
    expect(disputeCalls[0]!.args["balance_b"]).toBe(40n);
    expect(disputeCalls[0]!.args["sig"]).toBe("consumer-sig-seq5");

    // The chain should now reflect the dispute
    const ch = chain.getChannel(channelId)!;
    expect(ch.state).toBe("dispute");
    expect(ch.sequence).toBe(5n);

    // The callback must have fired
    expect(disputedEvents).toHaveLength(1);
    expect(disputedEvents[0]!.channelId).toBe(channelId);
    expect(disputedEvents[0]!.stalSequence).toBe(3n);
    expect(disputedEvents[0]!.ourSequence).toBe(5n);
  });
});

// ─── Watcher is a no-op while the channel is open ────────────────────────────

describe("watcher is idle when channel is open", () => {
  it("makes no dispute calls while state=open", async () => {
    const chain = new MemoryChain(() => 1_700_000_000n);
    const store = new MemoryStore();

    chain.seed({
      id: 1n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 100n,
      balance_b: 0n,
      sequence: 2n,
      state: "open",
      dispute_deadline: 1_700_004_000n,
      closing_started_at: 0n,
    });
    store.set({ channelId: 1n, sequence: 2n, balanceA: 100n, balanceB: 0n, signature: "sig" });

    const { ticks, options } = buildWatcher({ channelIds: [1n], store, transport: chain });
    const handle = watchChannels(options);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    expect(chain.invocations.filter((c) => c.method === "dispute")).toHaveLength(0);
  });
});

// ─── No state in store ────────────────────────────────────────────────────────

describe("watcher skips when no state in store", () => {
  it("makes no dispute call when store returns null", async () => {
    const chain = new MemoryChain(() => 1_700_000_000n);
    const store = new MemoryStore(); // empty

    chain.seed({
      id: 1n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 50n,
      balance_b: 50n,
      sequence: 2n,
      state: "closing",
      dispute_deadline: 1_700_004_000n,
      closing_started_at: 1_700_000_000n,
    });
    // store has nothing

    const { ticks, options } = buildWatcher({ channelIds: [1n], store, transport: chain });
    const handle = watchChannels(options);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    expect(chain.invocations.filter((c) => c.method === "dispute")).toHaveLength(0);
  });
});

// ─── On-chain nonce is already the newest ─────────────────────────────────────

describe("watcher skips when on-chain nonce ≥ consumer nonce", () => {
  it("does not dispute when chain sequence equals consumer sequence", async () => {
    const chain = new MemoryChain(() => 1_700_000_000n);
    const store = new MemoryStore();

    chain.seed({
      id: 1n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 50n,
      balance_b: 50n,
      sequence: 5n,
      state: "closing",
      dispute_deadline: 1_700_004_000n,
      closing_started_at: 1_700_000_000n,
    });
    store.set({ channelId: 1n, sequence: 5n, balanceA: 50n, balanceB: 50n, signature: "sig" });

    const { ticks, options } = buildWatcher({ channelIds: [1n], store, transport: chain });
    const handle = watchChannels(options);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    expect(chain.invocations.filter((c) => c.method === "dispute")).toHaveLength(0);
  });
});

// ─── onDeadlineApproaching fires inside threshold ─────────────────────────────

describe("deadline alert fires when window is short", () => {
  it("fires onDeadlineApproaching when remaining ≤ alertThresholdSeconds", async () => {
    let nowMs = 1_700_000_000_000;
    const nowSec = () => BigInt(Math.floor(nowMs / 1000));

    const chain = new MemoryChain(nowSec);
    const store = new MemoryStore();

    const deadline = nowSec() + 60n; // 60 s from now — well below the 300 s default

    chain.seed({
      id: 1n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 80n,
      balance_b: 20n,
      sequence: 3n,
      state: "closing",
      dispute_deadline: deadline,
      closing_started_at: nowSec() - 10n,
    });

    // Store has the SAME sequence (no dispute needed), but deadline is close
    store.set({ channelId: 1n, sequence: 3n, balanceA: 80n, balanceB: 20n, signature: "sig" });

    const alerts: DeadlineApproachingEvent[] = [];

    const { ticks, options } = buildWatcher({
      channelIds: [1n],
      store,
      transport: chain,
      now: () => nowMs,
      alertThresholdSeconds: 300n,
      onDeadlineApproaching: (ev) => { alerts.push(ev); },
    });

    const handle = watchChannels(options);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0]!.channelId).toBe(1n);
    expect(alerts[0]!.remainingSeconds).toBeLessThanOrEqual(300n);
  });
});

// ─── Does not re-dispute after winning ────────────────────────────────────────

describe("watcher does not re-dispute after winning", () => {
  it("calls dispute exactly once even across multiple poll ticks", async () => {
    let nowMs = 1_700_000_000_000;
    const nowSec = () => BigInt(Math.floor(nowMs / 1000));

    const chain = new MemoryChain(nowSec);
    const store = new MemoryStore();

    chain.seed({
      id: 1n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 60n,
      balance_b: 40n,
      sequence: 5n,
      state: "open",
      dispute_deadline: nowSec() + 3600n,
      closing_started_at: 0n,
    });
    store.set({ channelId: 1n, sequence: 7n, balanceA: 60n, balanceB: 40n, signature: "sig7" });

    const { ticks, options } = buildWatcher({
      channelIds: [1n],
      store,
      transport: chain,
      now: () => nowMs,
    });
    const handle = watchChannels(options);

    // Tick 1: open — no action
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Now trigger a stale close
    chain.staleClose(1n, 3n, nowSec() + 3600n);

    // Tick 2: watcher fires dispute
    ticks.shift()?.(); // advance sleep
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Tick 3: channel is now "dispute" state; no second submit
    ticks.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    const disputeCalls = chain.invocations.filter((c) => c.method === "dispute");
    expect(disputeCalls).toHaveLength(1);
  });
});

// ─── Retry after transient failure ───────────────────────────────────────────

describe("watcher retries after a failed dispute attempt", () => {
  it("wins on the second attempt after the first fails", async () => {
    let failOnce = true;
    const nowSec = () => 1_700_000_000n;

    const chain = new MemoryChain(nowSec);
    const store = new MemoryStore();

    chain.seed({
      id: 1n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 50n,
      balance_b: 50n,
      sequence: 2n,
      state: "closing",
      dispute_deadline: 1_700_004_000n,
      closing_started_at: 1_700_000_000n,
    });
    store.set({ channelId: 1n, sequence: 5n, balanceA: 50n, balanceB: 50n, signature: "sig" });

    const errors: DisputeErrorEvent[] = [];
    const wins:   DisputeSubmittedEvent[] = [];

    // Wrap transport to fail the first invoke
    const wrappedTransport: ChannelTransport = {
      read: (c) => chain.read(c),
      async invoke(c) {
        if (failOnce && c.method === "dispute") {
          failOnce = false;
          throw new Error("transient RPC error");
        }
        return chain.invoke(c);
      },
    };

    const { ticks, options } = buildWatcher({
      channelIds: [1n],
      store,
      transport: wrappedTransport,
      onDisputeError: (ev) => { errors.push(ev); },
      onDisputeSubmitted: (ev) => { wins.push(ev); },
    });
    const handle = watchChannels(options);

    const flush = () => new Promise<void>((r) => setImmediate(r));

    // Tick 1: attempt fails
    await flush();

    // Tick 2: attempt succeeds — unblock the sleep, then flush
    ticks.shift()?.();
    await flush();

    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    expect(errors).toHaveLength(1);
    expect(wins).toHaveLength(1);
    expect(wins[0]!.ourSequence).toBe(5n);
  });
});

// ─── Multiple channels — only stale one is disputed ──────────────────────────

describe("multiple channels — only the stale one is disputed", () => {
  it("disputes channel 2 (stale) but not channel 1 (fair close)", async () => {
    const nowSec = () => 1_700_000_000n;
    const chain  = new MemoryChain(nowSec);
    const store  = new MemoryStore();

    // Channel 1: closed at sequence 5, consumer also has 5 → fair close
    chain.seed({
      id: 1n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 50n,
      balance_b: 50n,
      sequence: 5n,
      state: "closing",
      dispute_deadline: 1_700_004_000n,
      closing_started_at: 1_700_000_000n,
    });
    store.set({ channelId: 1n, sequence: 5n, balanceA: 50n, balanceB: 50n, signature: "sig1" });

    // Channel 2: closed at sequence 2, consumer has 7 → stale close
    chain.seed({
      id: 2n,
      depositor: "GCONSUMER",
      counterparty: "GPROVIDER",
      token: "CUSDC",
      balance_a: 80n,
      balance_b: 20n,
      sequence: 2n,
      state: "closing",
      dispute_deadline: 1_700_004_000n,
      closing_started_at: 1_700_000_000n,
    });
    store.set({ channelId: 2n, sequence: 7n, balanceA: 80n, balanceB: 20n, signature: "sig2" });

    const disputed: bigint[] = [];
    const { ticks, options } = buildWatcher({
      channelIds: [1n, 2n],
      store,
      transport: chain,
      onDisputeSubmitted: (ev) => { disputed.push(ev.channelId); },
    });
    const handle = watchChannels(options);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    expect(disputed).toEqual([2n]);
    const disputeCalls = chain.invocations.filter((c) => c.method === "dispute");
    expect(disputeCalls).toHaveLength(1);
    expect(disputeCalls[0]!.args["channel_id"]).toBe(2n);
  });
});

// ─── Stop and stopped ─────────────────────────────────────────────────────────

describe("WatchHandle lifecycle", () => {
  it("stop() ends the loop and stopped resolves", async () => {
    const chain = new MemoryChain(() => 1_700_000_000n);
    const store = new MemoryStore();

    const { ticks, options } = buildWatcher({ channelIds: [], store, transport: chain });
    const handle = watchChannels(options);

    let resolved = false;
    void handle.stopped.then(() => { resolved = true; });

    handle.stop();
    ticks.forEach((t) => t());
    await handle.stopped;

    expect(resolved).toBe(true);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("watchChannels option validation", () => {
  const chain = new MemoryChain(() => 1_700_000_000n);
  const store = new MemoryStore();
  const base: WatchChannelsOptions = {
    channelIds: [1n],
    contractId: "CCHANNEL",
    caller: "GCONSUMER",
    store,
    signer: noopSigner,
    transport: chain,
  };

  it("throws ValidationError when contractId is missing", () => {
    expect(() =>
      watchChannels({ ...base, contractId: "" }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when caller is missing", () => {
    expect(() =>
      watchChannels({ ...base, caller: "" }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when store is missing", () => {
    expect(() =>
      watchChannels({ ...base, store: null as any }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when signer is missing", () => {
    expect(() =>
      watchChannels({ ...base, signer: null as any }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when transport is missing", () => {
    expect(() =>
      watchChannels({ ...base, transport: null as any }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError for a non-positive pollIntervalMs", () => {
    expect(() =>
      watchChannels({ ...base, pollIntervalMs: 0 }),
    ).toThrow(ValidationError);
  });
});
