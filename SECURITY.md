# Security Policy

## Reporting a Vulnerability

The SYNCRO team takes the security of our smart contracts, gateway, and infrastructure seriously. We appreciate the responsible disclosure of any vulnerabilities found.

Please report security vulnerabilities by emailing:
**security@syncro.network** (or via our encrypted disclosure portal).

### Response SLA
- **Initial Acknowledgment:** Within 24 hours
- **Severity Triage & Assessment:** Within 48 hours
- **Fix & Patch Deployment:** Within 7 business days (Critical: <24h)

---

## Scope for v3

### In-Scope Assets
- **Smart Contracts (Soroban / Stellar & EVM Bridge):**
  - Core Vaults & Pool logic
  - Settlement contracts
  - Reentrancy, flash loan resilience, and math precision
- **Gateway & Relayer:**
  - Transaction submission endpoints
  - RPC relay authentication and rate limiting
  - Replay protection mechanisms
- **Client SDKs:**
  - Cryptographic key handling and signature verification
  - Transaction deserialization and state caching

### Out-of-Scope
- Denial of Service (DoS) attacks on third-party RPC endpoints
- Phishing, social engineering, or compromise of user private keys
- Automated scanner reports without a functional Proof of Concept (PoC)
- Pre-announced planned breaking changes in development testnets

---

## Reward Table (Bug Bounty Program)

Bounties are paid out through the Stellar Wave / Drips Network escrow protocol:

| Severity | CVSS v3.1 Range | Reward (USD / XLM) |
| :--- | :--- | :--- |
| **Critical** | 9.0 – 10.0 | $5,000 – $10,000 |
| **High** | 7.0 – 8.9 | $2,000 – $4,500 |
| **Medium** | 4.0 – 6.9 | $500 – $1,500 |
| **Low** | 0.1 – 3.9 | $100 – $300 |

*Rewards are denominated in USD and paid in native XLM or USDC to verified researcher wallets.*

---

## Safe Harbor
Researchers who adhere to this policy will not face legal action and will be eligible for bounty rewards.
