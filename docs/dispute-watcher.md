# Consumer-Side Dispute Watcher

**Issue:** #1796  
**SDK module:** `sdk/src/channels/watcher.ts`  
**CLI entry point:** `sdk/src/cli/dispute-watcher.ts`

---

## Why a consumer needs to run the watcher

A SYNCRO payment channel is a bilateral escrow: both the consumer and the provider sign off-chain state updates (each one increasing the sequence number). When the channel is closed, one party submits the *final* signed state on-chain and starts the challenge window.

**The fraud case:** A provider — or any attacker who intercepts the channel — can try to close at an *older* signed state that is more favourable to them. For example, if the consumer's latest state is sequence 5 (consumer has 60 XLM), the attacker might submit sequence 2 (consumer has only 20 XLM), pocketing the difference.

**What the dispute mechanism gives you:** Soroban's payment-channel contract holds the channel in the `closing` state for a configurable challenge window (e.g. 1 hour). During that window, any party can submit a *newer* signed state via the `dispute` contract method. If the consumer's newer state is accepted, the channel moves to the `dispute` state and the final settlement reflects the correct balances.

**Why not rely on SYNCRO's settlement engine alone?** SYNCRO's settlement engine (#1458) watches for stale closes on behalf of users who opt in to its protection. However, a trust-minimised consumer should maintain an independent watcher for two reasons:

1. **Availability:** If SYNCRO is unreachable during the challenge window, your funds can be stolen.
2. **Trust model:** The watcher holds your *own* signed states and submits your *own* dispute transaction. You don't rely on a third party to act in your interest.

**Rule of thumb — run the watcher when:**

| Condition | Run the watcher? |
|---|---|
| You hold channels with untrusted or anonymous providers | **Yes** |
| Your channel balance is large relative to transaction costs | **Yes** |
| Your channel's dispute window is short (< 1 hour) | **Yes, with a low poll interval** |
| You operate in an environment where SYNCRO may be unreachable | **Yes** |
| You hold channels only with SYNCRO-verified providers AND you accept SYNCRO as a trust anchor | Optional |
| You are a provider, not a consumer | No (the provider initiates close; the consumer disputes) |

---

## How the watcher works

```
 Consumer                On-chain contract
    │                         │
    │   ←── poll get_channel ─┤  (every pollIntervalMs)
    │                         │
    │   state = "closing"?    │
    │   sequence on-chain < our latest sequence?
    │                         │
    │   yes → submit dispute  │
    │   ──────── dispute ────►│
    │                         │  state → "dispute"
    │                         │  sequence updated to ours
    │   ←─── success ─────────┤
    │                         │
    │   onDisputeSubmitted()  │
```

The watcher also fires `onDeadlineApproaching` when the remaining challenge window falls below `alertThresholdSeconds` (default: 5 minutes), so you can page an operator if the automatic dispute submission is failing.

---

## Quick start — library usage

```ts
import { watchChannels } from "@syncro/sdk";

const store: ChannelStateStore = {
  async getLatest(channelId) {
    // Return the newest signed state from your DB, or null.
    return db.getChannelState(channelId);
  },
};

const signer: DisputeSigner = {
  async sign(state) {
    // Re-sign the state with your spending key, or return the pre-signed signature.
    return state.signature;
  },
};

const handle = watchChannels({
  channelIds:            [1n, 2n, 3n],
  contractId:            "CCHANNEL_CONTRACT_ID",
  caller:                "GCONSUMER_PUBLIC_KEY",
  store,
  signer,
  transport:             sorobanTransport,  // your ChannelTransport implementation
  pollIntervalMs:        10_000,            // poll every 10 s
  alertThresholdSeconds: 300n,              // alert with 5 min remaining

  onDisputeSubmitted(ev) {
    logger.warn("Stale close countered", {
      channelId:   ev.channelId,
      staleAt:     ev.stalSequence,
      ourSequence: ev.ourSequence,
    });
  },

  onDeadlineApproaching(ev) {
    ops.alert("Challenge window closing", {
      channelId:       ev.channelId,
      remainingSecs:   ev.remainingSeconds,
      alreadyDisputed: ev.alreadyDisputed,
    });
  },

  onDisputeError(ev) {
    logger.error("Dispute failed — will retry on next tick", { error: ev.error });
  },
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  handle.stop();
  await handle.stopped;
  process.exit(0);
});
```

---

## Quick start — CLI daemon

```sh
export SYNCRO_SPENDING_KEY="$(cat spending-key.pem)"
export SYNCRO_STATE_STORE_PATH="./channel-states.json"

node dist/cli/dispute-watcher.js \
  --contract  CCHANNEL_CONTRACT_ID   \
  --caller    GCONSUMER_PUBLIC_KEY   \
  --channels  1,2,3                 \
  --poll      10000                 \
  --alert     300                   \
  --rpc       https://soroban-rpc.example.com \
  --json
```

The `--json` flag emits newline-delimited JSON for log aggregators. Without it, human-readable coloured output is printed to stdout.

The CLI daemon exits cleanly on `SIGINT` or `SIGTERM`, waiting for the current poll tick to complete.

**State store format (`channel-states.json`):**

```json
{
  "1": {
    "channelId": "1",
    "sequence":  "7",
    "balanceA":  "60000000",
    "balanceB":  "40000000",
    "signature": "<hex or base64 signature>"
  }
}
```

Each entry must be updated whenever you sign a new off-chain state. In production, use a database rather than a plain file so the store is durable against process crashes.

---

## API reference

### `watchChannels(options): WatchHandle`

Starts the watcher loop in the background.

| Option | Type | Default | Description |
|---|---|---|---|
| `channelIds` | `bigint[]` | — | Channel IDs to watch (required) |
| `contractId` | `string` | — | Soroban contract ID (required) |
| `caller` | `string` | — | Consumer's public key (required) |
| `store` | `ChannelStateStore` | — | Provides latest signed states (required) |
| `signer` | `DisputeSigner` | — | Signs dispute submissions (required) |
| `transport` | `ChannelTransport` | — | On-chain read/write (required) |
| `pollIntervalMs` | `number` | `10000` | Milliseconds between polls |
| `alertThresholdSeconds` | `bigint` | `300n` | Seconds remaining to trigger alert |
| `onDisputeSubmitted` | `(ev) => void` | — | Called after a successful dispute |
| `onDeadlineApproaching` | `(ev) => void` | — | Called when window is short |
| `onDisputeError` | `(ev) => void` | — | Called when dispute submission fails |
| `now` | `() => number` | `Date.now` | Injectable clock (for testing) |
| `sleep` | `(ms) => Promise<void>` | `setTimeout` | Injectable sleep (for testing) |

### `WatchHandle`

| Member | Description |
|---|---|
| `stop()` | Signal the loop to stop after the current tick |
| `stopped` | `Promise<void>` that resolves when the loop has exited |

### `ChannelStateStore`

```ts
interface ChannelStateStore {
  getLatest(channelId: bigint): Promise<SignedChannelState | null> | SignedChannelState | null;
}
```

### `DisputeSigner`

```ts
interface DisputeSigner {
  sign(state: SignedChannelState): Promise<string> | string;
}
```

### `SignedChannelState`

```ts
interface SignedChannelState {
  channelId: bigint;
  sequence:  bigint;
  balanceA:  bigint;
  balanceB:  bigint;
  signature: string; // hex or base64, passed verbatim to the dispute call
}
```

---

## Security notes

- **Keep the state store durable.** If your store loses the latest signed state, you cannot dispute a stale close. Write every new signed state to durable storage before acknowledging it.
- **Keep the spending key secure.** The signer has the authority to submit on-chain transactions. Use a hardware security module or a key management service in production; never store the raw PEM in source code.
- **Set the poll interval below half the dispute window.** If your challenge window is 1 hour, polling every 10 seconds gives you ~359 attempts before the window closes.
- **Callback errors are swallowed.** The watcher catches exceptions thrown by `onDisputeSubmitted`, `onDeadlineApproaching`, and `onDisputeError` so a buggy callback cannot kill the loop. Log inside callbacks instead of throwing.
