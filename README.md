[![TypeScript Check](https://github.com/Calebux/SYNCRO/actions/workflows/typecheck.yml/badge.svg)](https://github.com/Calebux/SYNCRO/actions/workflows/typecheck.yml)
# SYNCRO

![Tests](https://github.com/Calebux/SYNCRO/actions/workflows/test.yml/badge.svg)

## SYNCRO — Metered Payment Rails for Autonomous Agents

SYNCRO is a **pay-per-call settlement layer on Stellar**. An agent, a script, or an
application calls a paid API; SYNCRO meters the call off-chain, settles it over a
Soroban payment channel, and returns a signed receipt the payer can verify
independently. No subscription, no invoice, no seat count — the unit of billing is
the request.

> **Direction change.** SYNCRO was previously a self-custodial subscription manager.
> That product is being retired. The settlement primitives it produced — payment
> channels, scoped agent authority, on-chain spend caps, and an escrow dispute path
> — are the foundation of the current direction. See
> [`docs/architecture/v3-metered-rails.md`](./docs/architecture/v3-metered-rails.md)
> for the target architecture and the migration plan.

## Why metering instead of subscriptions

Recurring billing assumes a human who subscribes once and pays monthly. Autonomous
software does not behave that way. It makes a thousand calls in a minute and none for
a week; it spins up, spends, and is destroyed; it has no card and no billing address.
Charging it a monthly fee is the wrong shape.

SYNCRO bills what actually happened:

- **Per-call, not per-month** — the meter is the source of truth, settled continuously.
- **No custody** — funds sit in a payment channel the payer can unilaterally close.
- **No per-call gas** — calls accumulate off-chain as signed channel states; the chain
  is touched on open, top-up, and close.
- **Scoped authority** — an agent spends only within the scope and cap its principal
  granted it, enforced on-chain rather than by the gateway alone.
- **Verifiable** — every settled call produces a receipt binding the request hash, the
  meter reading, the channel state, and the provider's signature.

## Architecture

```
  Consumer agent                    SYNCRO                        Provider API
  ─────────────                     ──────                        ────────────
                                                                               
  1. request  ──────────────►  Gateway                                         
                               ├─ resolve API key → agent identity             
                               ├─ check Registry scope + cap                   
  2. ◄── 402 + challenge ──────┤  (no open channel / cap exceeded)             
                                                                               
  3. signed channel state ──►  Gateway ──► Meter ──► proxy ──► 4. upstream call
                                            │                                  
  5. ◄── response + receipt ───────────────┘                                   
                                                                               
                               Settlement engine                               
                               ├─ batches channel states                       
                               ├─ submits on close / threshold                 
                               └─ Soroban: channel, registry, caps, escrow     
```

### Components

| Component | Source | Role |
|---|---|---|
| **Gateway** | `backend/src/routes` | 402 challenge, key → identity, scope + cap admission |
| **Meter** | `quota_guard/` | usage counting, aggregation windows, idempotency, degraded mode |
| **Settlement engine** | `backend/src/services` | channel lifecycle, state signing, batching, reconciliation |
| **Registry** | `contracts/agent-registry` | agent identity and scoped delegated authority |
| **Channels** | `contracts/payment-channel` | open, submit_state, initiate_close, dispute, finalize, top_up |
| **Caps** | `contracts/virtual-card` | on-chain spend limits per agent, `can_transact` admission |
| **Disputes** | `contracts/escrow` | contested usage: deposit, approve_release, raise_dispute, resolve |
| **Receipts** | `shared/`, `sdk/` | signed usage receipts and independent verification |

### What was retired

`subscription_renewal`, `subscription_logging`, `subscription-math`, the reminder and
renewal engines, gift-card ledgering, and email rescanning are removed. The migration
path for existing records is tracked in the v3 epic.

## Status

The settlement contracts — channels, registry, caps, and escrow — are written and tested
on Stellar testnet. The gateway, meter, and settlement engine are being rebuilt around
them. Nothing here is on mainnet yet. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
development setup.

## v3 Rewrite

SYNCRO is mid-rewrite from the subscription product to metered agent payment rails,
tracked in [#1404](https://github.com/Calebux/SYNCRO/issues/1404). The work surface is
the open [`v3-rewrite`](https://github.com/Calebux/SYNCRO/labels/v3-rewrite) issues.
The earlier v2 rewrite ([#1323](https://github.com/Calebux/SYNCRO/issues/1323)) is
superseded; its infrastructure and quality work carries over, its product work does not.

## Project Structure & Ownership

- [Directory Ownership Matrix](./docs/archive/DIRECTORY_OWNERSHIP_MATRIX.md) — complete ownership information
- [Ownership Quick Reference](./docs/archive/OWNERSHIP_QUICK_REFERENCE.md) — quick lookup guide
- [CODEOWNERS](./.github/CODEOWNERS) — GitHub enforcement
- [Code Review Process](./docs/code-review-process.md) — review procedures

## Environment Variables

Each package declares its environment variables in a manifest that drives both the
`.env.example` files and CI validation. See [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md)
for the canonical strategy: per-package required/optional variables, naming conventions,
the CI enforcement model, and how to add a new variable.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines and development
setup instructions.
