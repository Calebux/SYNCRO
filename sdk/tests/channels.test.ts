import { AuthError, ValidationError } from "../src/errors.js";
import {
  CHANNEL_SCOPE,
  ChannelClient,
  ChannelScopeError,
  type ChannelInvocation,
  type ChannelScope,
  type ChannelTransport,
} from "../src/channels/index.js";

const ALL_SCOPES = Object.values(CHANNEL_SCOPE) as ChannelScope[];

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
 * Minimal stand-in for the payment-channel contract. Records every call so
 * tests can prove a rejected scope never reaches it.
 */
class MemoryChannelChain implements ChannelTransport {
  readonly calls: ChannelInvocation[] = [];
  private nextId = 1n;
  private readonly channels = new Map<string, StoredChannel>();

  constructor(private readonly now: () => number) {}

  async invoke(call: ChannelInvocation): Promise<unknown> {
    this.calls.push(call);
    switch (call.method) {
      case "open_channel":
        return this.open(call.args);
      case "top_up":
        this.topUp(call.args);
        return null;
      case "initiate_close":
        this.initiateClose(call.args);
        return null;
      case "finalize":
        this.finalize(call.args);
        return null;
      default:
        throw new Error(`unexpected invoke ${call.method}`);
    }
  }

  async read(call: ChannelInvocation): Promise<unknown> {
    this.calls.push(call);
    if (call.method !== "get_channel") {
      throw new Error(`unexpected read ${call.method}`);
    }
    const id = call.args.channel_id as bigint;
    const channel = this.channels.get(id.toString());
    return channel ? { ...channel } : null;
  }

  debit(channelId: bigint, amount: bigint): void {
    const channel = this.require(channelId);
    if (channel.balance_a < amount) throw new Error("insufficient");
    channel.balance_a -= amount;
    channel.balance_b += amount;
    channel.sequence += 1n;
  }

  private open(args: Record<string, unknown>): bigint {
    const id = this.nextId++;
    const nowSec = BigInt(Math.floor(this.now() / 1000));
    const window = args.dispute_window as bigint;
    const channel: StoredChannel = {
      id,
      depositor: args.depositor as string,
      counterparty: args.counterparty as string,
      token: args.token as string,
      balance_a: args.deposit_amount as bigint,
      balance_b: 0n,
      sequence: 0n,
      state: "open",
      dispute_deadline: nowSec + window,
      closing_started_at: 0n,
    };
    this.channels.set(id.toString(), channel);
    return id;
  }

  private topUp(args: Record<string, unknown>): void {
    const channel = this.require(args.channel_id as bigint);
    if (channel.state !== "open") throw new Error("invalid state");
    channel.balance_a += args.amount as bigint;
  }

  private initiateClose(args: Record<string, unknown>): void {
    const channel = this.require(args.channel_id as bigint);
    if (channel.state !== "open") throw new Error("invalid state");
    channel.balance_a = args.balance_a as bigint;
    channel.balance_b = args.balance_b as bigint;
    channel.sequence = args.seq as bigint;
    channel.state = "closing";
    channel.closing_started_at = BigInt(Math.floor(this.now() / 1000));
  }

  private finalize(args: Record<string, unknown>): void {
    const channel = this.require(args.channel_id as bigint);
    const nowSec = BigInt(Math.floor(this.now() / 1000));
    if (nowSec <= channel.dispute_deadline) throw new Error("dispute window active");
    if (args.expected_sequence !== channel.sequence) throw new Error("stale sequence");
    channel.state = "closed";
  }

  private require(channelId: bigint): StoredChannel {
    const channel = this.channels.get(channelId.toString());
    if (!channel) throw new Error("not found");
    return channel;
  }
}

function client(options: {
  scopes: readonly ChannelScope[];
  chain: MemoryChannelChain;
  now: () => number;
  autoTopUp?: { floor: bigint; amount: bigint };
}): ChannelClient {
  return new ChannelClient({
    contractId: "CCHANNEL",
    caller: "GDEPOSITOR",
    scopes: options.scopes,
    transport: options.chain,
    now: options.now,
    ...(options.autoTopUp ? { autoTopUp: options.autoTopUp } : {}),
  });
}

describe("ChannelClient", () => {
  it("opens a funded channel, watches burn, tops up, and closes after the challenge period", async () => {
    let now = 1_700_000_000_000;
    const chain = new MemoryChannelChain(() => now);
    const channels = client({
      scopes: ALL_SCOPES,
      chain,
      now: () => now,
      autoTopUp: { floor: 40n, amount: 30n },
    });

    const opened = await channels.open({
      counterparty: "GCOUNTER",
      token: "CTOKEN",
      deposit: 100n,
      disputeWindowSeconds: 3600n,
    });

    expect(opened.balance).toBe(100n);
    expect(opened.counterpartyBalance).toBe(0n);
    expect(opened.state).toBe("open");
    expect(opened.disputeDeadline).toBe(1_700_000_000n + 3600n);
    expect(await channels.getBurnRate(opened.id)).toBeNull();

    chain.debit(opened.id, 20n);
    now += 10_000;
    const watched = await channels.getBalance(opened.id);
    expect(watched.balance).toBe(80n);
    expect(watched.burnRatePerSecond).toBe(2n);

    await channels.topUp(opened.id, 20n);
    const topped = await channels.getBalance(opened.id);
    expect(topped.balance).toBe(100n);

    chain.debit(opened.id, 60n);
    now += 10_000;
    const funded = await channels.ensureFunded(opened.id);
    expect(funded.toppedUp).toBe(true);
    expect(funded.amount).toBe(30n);
    expect(funded.balance).toBe(70n);

    const stillFunded = await channels.ensureFunded(opened.id);
    expect(stillFunded.toppedUp).toBe(false);
    expect(stillFunded.amount).toBe(0n);

    const closing = await channels.initiateClose({
      channelId: opened.id,
      balanceA: 60n,
      balanceB: 10n,
      sequence: 3n,
    });
    expect(closing.channel.state).toBe("closing");
    expect(closing.challenge.fundsAvailableImmediately).toBe(false);
    expect(closing.challenge.windowSeconds).toBe(3600n);
    expect(closing.challenge.availableAt).toBe(opened.disputeDeadline);
    expect(closing.challenge.remainingSeconds).toBeGreaterThan(0n);
    expect(closing.challenge.notice).toContain("Funds are not instantly available");
    expect(closing.challenge.notice).toContain("3600 seconds");
    expect(closing.challenge.notice).toContain(opened.disputeDeadline.toString());

    now = Number(closing.challenge.availableAt) * 1000 + 1000;
    const closed = await channels.finalize(opened.id, closing.channel.sequence);
    expect(closed.state).toBe("closed");
    expect(closed.balance).toBe(60n);
  });

  it("rejects operations outside the caller scope before calling the transport", async () => {
    const now = () => 1_700_000_000_000;
    const chain = new MemoryChannelChain(now);
    const channels = client({
      scopes: [CHANNEL_SCOPE.read],
      chain,
      now,
      autoTopUp: { floor: 10n, amount: 10n },
    });

    await expect(
      channels.open({
        counterparty: "GCOUNTER",
        token: "CTOKEN",
        deposit: 100n,
        disputeWindowSeconds: 60n,
      }),
    ).rejects.toMatchObject({
      operation: "open",
      requiredScope: CHANNEL_SCOPE.open,
    });

    await expect(channels.topUp(1n, 5n)).rejects.toBeInstanceOf(ChannelScopeError);
    await expect(
      channels.initiateClose({ channelId: 1n, balanceA: 1n, balanceB: 0n, sequence: 1n }),
    ).rejects.toBeInstanceOf(ChannelScopeError);
    await expect(channels.finalize(1n, 1n)).rejects.toBeInstanceOf(ChannelScopeError);
    await expect(channels.ensureFunded(1n)).rejects.toBeInstanceOf(ChannelScopeError);

    const denied = client({ scopes: [], chain, now });
    await expect(denied.getBalance(1n)).rejects.toBeInstanceOf(ChannelScopeError);
    await expect(denied.getBurnRate(1n)).rejects.toBeInstanceOf(AuthError);
    expect(chain.calls).toEqual([]);
  });

  it("does not top up when auto top-up is not configured", async () => {
    const now = () => 1_700_000_000_000;
    const chain = new MemoryChannelChain(now);
    const channels = client({ scopes: ALL_SCOPES, chain, now });

    await expect(channels.ensureFunded(1n)).rejects.toBeInstanceOf(ValidationError);
    expect(chain.calls).toEqual([]);
  });

  it("rejects a non-positive deposit before opening", async () => {
    const now = () => 1_700_000_000_000;
    const chain = new MemoryChannelChain(now);
    const channels = client({ scopes: ALL_SCOPES, chain, now });

    await expect(
      channels.open({
        counterparty: "GCOUNTER",
        token: "CTOKEN",
        deposit: 0n,
        disputeWindowSeconds: 60n,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(chain.calls).toEqual([]);
  });
});
