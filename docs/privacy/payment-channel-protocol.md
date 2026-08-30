# Payment Channel Protocol Specification

## Overview

This document specifies the state machine and protocol for Stellar-based payment channels used for private recurring subscription payments in SYNCRO. Payment channels allow multiple subscription renewals to occur off-chain, with only two on-chain transactions required: one to open the channel and one to close it.

## Architecture

Payment channels use a **2-of-2 multisig escrow** between the user (payer) and the SYNCRO executor (payee). Funds are locked in the escrow account, and both parties sign off-chain balance updates for each renewal cycle. This provides privacy by minimizing the on-chain footprint of recurring payments.

### Key Components

- **Escrow Account**: A Stellar account requiring 2-of-2 multisig (user + executor)
- **Balance Allocation**: A signed off-chain state representing the current split of funds
- **Sequence Number**: Monotonically increasing counter ensuring state ordering
- **Time-Lock**: Prevents premature unilateral close; enables dispute resolution

## State Machine

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌──────────┐   deposit    ┌──────────┐   both sign    ┌──────────┐
│          │──────────────▶│          │───────────────▶│          │
│  IDLE    │              │  OPEN    │                │  ACTIVE  │◄──┐
│          │              │          │                │          │───┘
└──────────┘              └──────────┘                └────┬─────┘
                                                          │  off-chain
                                                          │  renewals
                          ┌──────────┐                    │
                          │          │◄───────────────────┘
                          │ CLOSING  │   close initiated
                          │          │
                          └────┬─────┘
                               │
                    ┌──────────┼──────────┐
                    │          │          │
                    ▼          ▼          ▼
              ┌──────────┐ ┌──────┐ ┌─────────┐
              │ DISPUTED │ │CLOSED│ │TOP-UP   │
              │          │ │      │ │(→ACTIVE)│
              └────┬─────┘ └──────┘ └─────────┘
                   │
                   ▼
              ┌──────────┐
              │  CLOSED  │
              └──────────┘
```

### States

| State | Description |
|-------|-------------|
| **IDLE** | No channel exists. User has not deposited funds. |
| **OPEN** | Escrow account created with initial deposit. Awaiting both parties to sign the initial state. |
| **ACTIVE** | Channel is operational. Off-chain balance updates occur each renewal cycle. |
| **CLOSING** | Close has been initiated (cooperative or unilateral). Dispute window is active for unilateral close. |
| **DISPUTED** | A counterparty has submitted a newer state during the dispute window. |
| **CLOSED** | Final state settled on-chain. Funds distributed according to the latest signed state. |

### State Transitions

| From | To | Trigger | Preconditions | Postconditions |
|------|----|---------|---------------|----------------|
| IDLE | OPEN | `openChannel(deposit)` | User has sufficient balance (XLM or USDC). Deposit amount >= minimum channel capacity. | Escrow account created. Funds locked in 2-of-2 multisig. Time-lock set for channel expiry. |
| OPEN | ACTIVE | `activateChannel()` | Both parties have signed the initial balance allocation (state sequence 0). | Channel ready for off-chain payments. Initial state: user balance = deposit, executor balance = 0. |
| ACTIVE | ACTIVE | `updateState(newAllocation)` | Both parties sign new balance allocation. New sequence number > previous. Total allocation = total deposited. | Off-chain state updated. No on-chain transaction. |
| ACTIVE | ACTIVE | `topUp(amount)` | User has sufficient balance. Channel is not expired. | On-chain deposit to escrow. New signed state reflects increased total capacity. |
| ACTIVE | CLOSING | `cooperativeClose()` | Both parties agree on final state and sign the closing transaction. | Final balance allocation submitted on-chain. Funds distributed immediately. |
| ACTIVE | CLOSING | `unilateralClose(latestState)` | One party submits their latest signed state on-chain. | Dispute window timer starts (T blocks). Submitted state is pending. |
| CLOSING | DISPUTED | `dispute(newerState)` | Counterparty submits a state with a higher sequence number within the dispute window. | Dispute timer resets. Newer state becomes the pending state. |
| CLOSING | CLOSED | Dispute window expires | No dispute submitted within T blocks. | Funds distributed per the pending state. Escrow account merged/closed. |
| DISPUTED | CLOSED | Dispute window expires | No further disputes within T blocks. | Funds distributed per the latest disputed state. |
| ACTIVE | CLOSING | Channel expiry reached | Time-lock has expired. | Either party can force-close with latest state. |

## Protocol Flows

### 1. Channel Open

```
User                          Stellar Network                    Executor
  │                                │                                │
  │  1. Create escrow account      │                                │
  │  (2-of-2 multisig)            │                                │
  │───────────────────────────────▶│                                │
  │                                │                                │
  │  2. Deposit XLM/USDC          │                                │
  │───────────────────────────────▶│                                │
  │                                │                                │
  │  3. Sign initial state (seq=0)│                                │
  │  user_balance=deposit          │                                │
  │  executor_balance=0            │                                │
  │────────────────────────────────────────────────────────────────▶│
  │                                │                                │
  │  4. Executor co-signs         │                                │
  │◄────────────────────────────────────────────────────────────────│
  │                                │                                │
  │  Channel ACTIVE               │                                │
  │                                │                                │
```

### 2. Off-Chain Renewal (State Update)

```
User                          (Off-Chain)                        Executor
  │                                                                │
  │  1. Renewal cycle triggered                                    │
  │                                                                │
  │  2. Propose new state (seq=N+1)                                │
  │  user_balance -= renewal_amount                                │
  │  executor_balance += renewal_amount                            │
  │───────────────────────────────────────────────────────────────▶│
  │                                                                │
  │  3. Executor validates & co-signs                              │
  │◄───────────────────────────────────────────────────────────────│
  │                                                                │
  │  Both parties store signed state locally                       │
  │  NO on-chain transaction                                       │
  │                                                                │
```

### 3. Cooperative Close

```
User                          Stellar Network                    Executor
  │                                │                                │
  │  1. Request close              │                                │
  │───────────────────────────────────────────────────────────────▶│
  │                                │                                │
  │  2. Both sign final closing tx │                                │
  │◄───────────────────────────────────────────────────────────────│
  │                                │                                │
  │  3. Submit closing tx on-chain │                                │
  │───────────────────────────────▶│                                │
  │                                │                                │
  │  4. Funds distributed:        │                                │
  │  user_balance → User           │                                │
  │  executor_balance → Executor   │                                │
  │                                │                                │
  │  Channel CLOSED               │                                │
  │                                │                                │
```

### 4. Unilateral Close

```
User                          Stellar Network                    Executor
  │                                │                                │
  │  1. Submit latest signed state │                                │
  │  on-chain (seq=N)             │                                │
  │───────────────────────────────▶│                                │
  │                                │                                │
  │  2. Dispute window starts      │                                │
  │  (T blocks)                    │                                │
  │                                │                                │
  │           ... T blocks pass, no dispute ...                     │
  │                                │                                │
  │  3. Dispute window expires     │                                │
  │                                │                                │
  │  4. Funds distributed per      │                                │
  │  submitted state               │                                │
  │                                │                                │
  │  Channel CLOSED               │                                │
  │                                │                                │
```

### 5. Dispute Resolution

```
User                          Stellar Network                    Executor
  │                                │                                │
  │  1. User submits stale state   │                                │
  │  (seq=K, where K < N)         │                                │
  │───────────────────────────────▶│                                │
  │                                │                                │
  │  2. Dispute window starts      │                                │
  │                                │                                │
  │  3. Executor submits newer     │                                │
  │  state (seq=N, N > K)         │                                │
  │                                │◄───────────────────────────────│
  │                                │                                │
  │  4. Network validates:         │                                │
  │  seq(N) > seq(K) ✓            │                                │
  │  Both signatures valid ✓       │                                │
  │                                │                                │
  │  5. Dispute window resets      │                                │
  │                                │                                │
  │           ... T blocks pass, no further dispute ...             │
  │                                │                                │
  │  6. Funds distributed per      │                                │
  │  state seq=N (latest)          │                                │
  │                                │                                │
  │  Channel CLOSED               │                                │
  │                                │                                │
```

### 6. Top-Up

```
User                          Stellar Network                    Executor
  │                                │                                │
  │  1. Deposit additional funds   │                                │
  │  to escrow account            │                                │
  │───────────────────────────────▶│                                │
  │                                │                                │
  │  2. Sign new state (seq=N+1)   │                                │
  │  reflecting increased capacity │                                │
  │───────────────────────────────────────────────────────────────▶│
  │                                │                                │
  │  3. Executor co-signs         │                                │
  │◄───────────────────────────────────────────────────────────────│
  │                                │                                │
  │  Channel remains ACTIVE        │                                │
  │  with higher capacity          │                                │
  │                                │                                │
```

## Time-Lock Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `DISPUTE_WINDOW` | 720 blocks (~1 hour on Stellar) | Time allowed for counterparty to submit a newer state after unilateral close. |
| `CHANNEL_EXPIRY` | 525,600 blocks (~365 days) | Maximum channel lifetime. After expiry, either party can force-close. |
| `MIN_CHANNEL_CAPACITY` | 10 USDC / 50 XLM | Minimum initial deposit to open a channel. |
| `TOP_UP_COOLDOWN` | 60 blocks (~5 minutes) | Minimum time between top-up operations to prevent spam. |

## Signed State Format

Each off-chain state update is a signed message with the following structure:

```typescript
interface ChannelState {
  channelId: string;          // Escrow account public key
  sequenceNumber: number;     // Monotonically increasing, starts at 0
  userBalance: string;        // User's balance in the channel (stroops)
  executorBalance: string;    // Executor's balance in the channel (stroops)
  asset: string;              // "native" (XLM) or USDC asset code
  expiresAt: number;          // Ledger number at which channel expires
  userSignature: string;      // User's ed25519 signature
  executorSignature: string;  // Executor's ed25519 signature
}
```

### Invariants

1. `userBalance + executorBalance == totalDeposited` (conservation of funds)
2. `sequenceNumber` is strictly monotonically increasing across updates
3. Both `userSignature` and `executorSignature` must be valid for a state to be accepted
4. The state with the **highest valid sequence number** always wins in disputes
5. `userBalance >= 0` and `executorBalance >= 0` (no negative balances)

## Dispute Resolution Soundness

The dispute mechanism ensures the latest state always prevails:

1. **Ordering**: States are totally ordered by `sequenceNumber`. A state with a higher sequence number is strictly newer.
2. **Authenticity**: Both parties must sign each state. Neither party can forge a state.
3. **Finality**: The dispute window gives the counterparty sufficient time to submit a newer state. After the window expires, the pending state becomes final.
4. **Incentive Compatibility**: Submitting a stale state is unprofitable — the counterparty will always have a newer state to dispute with. The stale-state submitter wastes transaction fees.
5. **Liveness**: Channel expiry ensures funds are never permanently locked, even if one party goes offline.

## Security Considerations

- **Key Storage**: Channel signing keys should be derived from the user's wallet using BIP-32 derivation to avoid key reuse.
- **State Backup**: Both parties must persist all signed states locally. Loss of state data may result in accepting an older (less favorable) state during dispute.
- **Replay Protection**: The `channelId` and `sequenceNumber` together form a unique identifier, preventing cross-channel replay attacks.
- **Privacy**: Only the open and close transactions appear on-chain. Individual renewal amounts and timing are not visible to blockchain observers.
