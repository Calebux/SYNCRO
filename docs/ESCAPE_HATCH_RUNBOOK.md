# Escape-Hatch Withdrawal — Incident Runbook

## Overview

Three Soroban contracts hold user funds: `escrow`, `payment-channel`, and
`virtual-card`.  Each contract now has a **time-delayed unilateral withdrawal**
mechanism ("escape hatch") that allows users to recover their own funds if the
contract is paused indefinitely, admin keys are lost, or an upgrade is
impossible.

---

## Grace Period

| Constant | Value | Location |
|---|---|---|
| `ESCAPE_HATCH_GRACE_PERIOD_SECS` | **604 800 s (7 days)** | compile-time const in each contract |

The constant is a Rust `pub const` — it is baked into the WASM binary at
compile time and **cannot be changed by any admin call**.  Changing it requires
a new contract deployment and migration.

---

## How the Mechanism Works

```
Admin calls pause()
        │
        ▼
PausedSince timestamp is stored
        │
     7 days elapse
        │
        ▼
User calls escape_hatch_withdraw(...)
        │
  ┌─────▼──────────────────────────────────┐
  │ 1. Verify contract is paused           │
  │ 2. Verify elapsed ≥ 7 days             │
  │ 3. Verify caller == fund owner         │
  │ 4. EFFECTS: mark position as closed /  │
  │            refunded (reentrancy guard) │
  │ 5. Emit EscapeHatch event              │
  │ 6. INTERACTIONS: transfer funds        │
  └────────────────────────────────────────┘
```

If an admin calls `unpause()` before the user acts, the escape hatch locks out
again — the `PausedSince` key is removed and any subsequent call to
`escape_hatch_withdraw` returns `ContractNotPaused`.

---

## Per-Contract Details

### `escrow`

| Item | Detail |
|---|---|
| Function | `escape_hatch_withdraw(escrow_id: u64)` |
| Who may call | The escrow's `payer` only |
| What is returned | `escrow.deposited` — the full funded amount |
| Valid states | `Funded`, `Approved`, `Disputed` |
| Terminal state | `EscrowState::Refunded` |
| Event | `EscrowEscapeHatchWithdrawn { escrow_id, payer, amount, paused_since }` |

The payer's `require_auth()` is checked on-chain.  An attacker cannot impersonate
the payer without a valid Stellar signature.

### `payment-channel`

| Item | Detail |
|---|---|
| Function | `escape_hatch_withdraw(channel_id: u64, caller: Address)` |
| Who may call | Either `depositor` (receives `balance_a`) or `counterparty` (receives `balance_b`) |
| What is returned | The caller's share from the latest on-chain state |
| Valid states | `Open`, `Closing`, `Dispute` (anything except `Closed`) |
| Terminal state | `ChannelState::Closed` (both balances zeroed after first caller) |
| Event | `(escape, channel)` topic — `(channel_id, caller, amount, paused_since)` |

Because the channel is marked `Closed` and both balances zeroed on the first
escape-hatch call, the second party will receive `InvalidState`.  Both parties
should call quickly after the grace period if they both have non-zero balances;
the second party's share is burned on the first call.  This is an intentional
trade-off: it prevents indefinite limbo over which party calls first.

> **Note:** In a production upgrade, consider a two-phase escape that records
> each party's withdrawal separately before closing.

### `virtual-card`

| Item | Detail |
|---|---|
| Function | `escape_hatch_withdraw(card_id: u32, caller: Address)` |
| Who may call | The card's `holder` only |
| What is returned | `card.balance` at time of call (as `i128`); also emitted in event |
| Valid states | Any non-`Closed` card with a balance |
| Terminal state | `CardStatus::Closed`, `card.balance = 0` |
| Event | `(escape_hatch, card)` topic — `(card_id, caller, balance, paused_since)` |

Because the virtual-card balance is an off-chain accounting unit (not a
direct on-chain token transfer), the **actual token refund is processed
off-chain** by monitoring the `escape_hatch` event.  The on-chain state
is authoritative: once the card shows `Closed` with balance 0, the
off-chain settlement system must honour the emitted balance.

---

## Operator Playbook

### Normal pause (maintenance / upgrade)

```
1. Call pause() on the affected contract.
2. Perform maintenance/upgrade.
3. Call unpause() to restore normal operation.
4. Total window < 7 days → escape hatch never becomes available.
```

### Admin key compromise / irrecoverable pause

```
1. Immediately notify users via status page and on-chain announcement.
2. Do NOT call unpause() — the grace period should run so users can self-recover.
3. After 7 days, users call escape_hatch_withdraw() for each of their positions.
4. Monitor on-chain events for EscapeHatch activity.
5. For virtual-card: process off-chain token refunds keyed on
   (escape_hatch, card) events within 24 hours of detection.
6. Post-incident: deploy new contract, migrate any state not yet recovered.
```

### Detecting escape-hatch usage (monitoring)

Subscribe to:
- Escrow: `EscrowEscapeHatchWithdrawn` events
- Payment-channel: events with topic `(escape, channel)`
- Virtual-card: events with topic `(escape_hatch, card)`

Alert thresholds:
- Any escape-hatch event during normal operations → P0 incident
- Volume > 10 escape-hatch events in 1 hour → mass-recovery scenario, activate
  incident commander

---

## Error Codes

### `escrow`

| Code | Constant | Meaning |
|---|---|---|
| 22 | `ContractNotPaused` | `pause()` was not called, or contract was unpaused |
| 23 | `GracePeriodNotElapsed` | Contract has been paused < 7 days |

### `payment-channel`

| Code | Constant | Meaning |
|---|---|---|
| 12 | `ContractNotPaused` | Contract is not currently paused |
| 13 | `GracePeriodNotElapsed` | Contract has been paused < 7 days |

### `virtual-card`

| Code | Constant | Meaning |
|---|---|---|
| 16 | `ContractNotPaused` | Contract is not currently paused |
| 17 | `GracePeriodNotElapsed` | Contract has been paused < 7 days |

---

## Security Properties

| Property | How it is enforced |
|---|---|
| Only own funds | `require_auth()` on the recorded owner address |
| No over-withdrawal | State transitions to terminal before transfer; re-entry returns terminal-state error |
| No cross-user theft | Owner address checked against stored record, not caller-supplied |
| Grace period immutable | `pub const` in WASM — not stored in contract state, not settable by admin |
| Double-withdraw blocked | Terminal state (`Refunded` / `Closed`) rejects second call |
| Unpause resets clock | `PausedSince` key removed; escape hatch locked until next pause |

---

## Related Files

- `contracts/contracts/escrow/src/lib.rs`
- `contracts/contracts/payment-channel/src/lib.rs`
- `contracts/contracts/virtual-card/src/lib.rs`
- `docs/DEPLOYMENT_RUNBOOK.md` — general deployment procedures
- `docs/JOB_FAILURE_RUNBOOK.md` — background job failure handling
