# ADR-002: Adoption of Soroban (Stellar Smart Contracts) over EVM

**Status:** Accepted (Retrospective)  
**Date:** 2026-05-28  
**Deciders:** Core Architecture Team  
**Issue/PR:** #120  

---

## Context

SYNCRO automates recurring subscription payments on-chain. When selecting a smart contract execution environment, the engineering team evaluated two major paradigms:

1. **EVM (Ethereum Virtual Machine)** — L1 (Ethereum) and L2s (Arbitrum, Optimism, Base).
2. **Soroban** — WebAssembly-based smart contract platform on the Stellar network.

Key operational requirements for subscription smart contracts include:
- **Predictable & Low Execution Costs**: Subscription renewals trigger monthly or periodic transactions. High or volatile gas fees destroy the economics of micro-subscriptions ($5–$20/month).
- **Sub-Second Finality**: Immediate confirmation for user-initiated subscription approvals and virtual card issuance.
- **Native Multi-Asset Support**: Seamless settlement in XLM and stablecoins (USDC) without custom wrapper contracts.
- **Strong Authorization & Security**: Rust-based memory safety and explicit footprint authorization model to prevent reentrancy and allowance draining.

EVM ecosystems require complex ERC-20 `approve`/`transferFrom` allowance mechanics or custom ERC-1337 recurring billing protocols, which introduce security risks (unlimited allowances) and volatile gas spikes.

---

## Decision

We chose **Soroban smart contracts on the Stellar network** as SYNCRO's execution engine.

- **Contracts Deployed:**
  - `SubscriptionRegistry`: Canonical subscription metadata registry.
  - `SubscriptionRenewal`: Renewal execution, authorization windows, and spending caps.
  - `VirtualCard`: Non-custodial virtual card state and payment execution.
  - `Escrow`: Arbiter-mediated escrow and dispute resolution.
- **Language & Runtime:** Rust compiled to WebAssembly (Wasm) executing on Soroban environment.

---

## Consequences

### Positive
- **Low & Deterministic Fees**: Network transaction fees remain well below $0.001 per renewal cycle, preserving micro-subscription viability.
- **Fast Finality**: Stellar's ~5-second ledger closing provides instant finality without waiting for L1 settlement windows.
- **Native Asset Liquidity**: Native integration with Stellar anchor network and USDC issuers without wrapping bridges.
- **Security Baseline**: Rust contract architecture avoids Solidity-specific vulnerabilities such as unhandled reentrancy and fallback hijackings.

### Negative
- **Ecosystem Maturity**: Soroban tooling and SDKs are newer compared to EVM toolchains (Hardhat, Foundry).
- **RPC Infrastructure**: Requires maintaining dedicated Soroban RPC node endpoints or using managed Soroban provider services.

### Neutral
- Contract interfaces are mirrored in TypeScript (`shared/src/soroban-contract-interfaces.ts`) to maintain backend type alignment.

---

## Compliance & Verification

- Smart contract unit tests are executed via `cargo test` in `contracts/`.
- Backend contract bindings integration tests run against Stellar Testnet in CI.
