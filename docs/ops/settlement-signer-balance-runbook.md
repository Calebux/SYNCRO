# Alert Runbook: Settlement Signer Balance (`settlement-signer-balance`)

> **Alert Class:** `settlement-signer-balance`  
> **Paging Severity:** `page` (P1 On-Call) for critical, `alert` (P2) for warning  
> **Job Description:** Scheduled job (default: every 15 minutes) that checks the settlement signer's XLM balance on the Stellar network and emits alerts when the balance falls below configured thresholds.

---

## 1. Overview & Thresholds

The settlement signer is the Stellar account that submits channel states and closes channels on-chain. Submitting states and closing channels costs network fees (in XLM). If the signer runs out of XLM, settlement stops silently and value at risk grows.

### Default Alert Thresholds
- **Warning (`alert`):** Balance falls to or below `SETTLEMENT_SIGNER_BALANCE_WARNING_THRESHOLD` (default: `100` XLM).
- **Critical (`page`):** Balance falls to or below `SETTLEMENT_SIGNER_BALANCE_CRITICAL_THRESHOLD` (default: `20` XLM).

Thresholds can be overridden via environment variables:
- `SETTLEMENT_SIGNER_BALANCE_WARNING_THRESHOLD`
- `SETTLEMENT_SIGNER_BALANCE_CRITICAL_THRESHOLD`
- `SETTLEMENT_SIGNER_BALANCE_CHECK_CRON` (default: `*/15 * * * *`)

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Settlement stops silently when the signer has insufficient XLM for network fees. Channel states and closes stop being submitted on-chain, causing value at risk to grow and payments to be stuck.
- **Sentry Alert Tags:**
  - `alertClass: settlement-signer-balance`
  - `service: backend`
  - `environment: <current environment>`

---

## 3. Response Procedure

### Warning Alert (Balance ≤ Warning Threshold)
1. Check the current signer balance on the Stellar Explorer (Horizon) for the account `G...` derived from `SETTLEMENT_SIGNER_SECRET_KEY`.
2. If the balance is genuinely low, prepare to refill the signer account.
3. Monitor the next balance check cycle (default: 15 minutes) to confirm the alert clears after refilling.

### Critical Alert (Balance ≤ Critical Threshold)
1. **Page the on-call engineer immediately.** Settlement is at risk of stalling.
2. Check the current signer balance on the Stellar Explorer.
3. Refill the signer account with XLM (see below).
4. Verify the alert clears on the next check cycle.
5. If the balance does not recover after refilling, investigate whether the signer secret key is correct and whether the account is not frozen or sponsored.

---

## 4. How to Refill the Settlement Signer

### Prerequisites
- Access to the wallet or funding source that holds XLM.
- The settlement signer's public key (derived from `SETTLEMENT_SIGNER_SECRET_KEY`).

### Steps
1. **Identify the signer account:**
   ```bash
   # The public key is derived from SETTLEMENT_SIGNER_SECRET_KEY.
   # You can also look it up in the Sentry alert `extra.accountId` field.
   ```
2. **Send XLM to the signer account** using any Stellar wallet or automation (e.g., `stellar-cli`, Friendbot on testnet, or a funded account on mainnet).
3. **Verify the balance** on [Stellar Expert](https://stellar.expert) or via Horizon:
   ```
   GET https://horizon.stellar.org/accounts/<SIGNER_PUBLIC_KEY>
   ```
4. **Confirm the alert clears** — the next scheduled check (default: every 15 minutes) will emit a recovery log and the Sentry alert will auto-resolve.

### Minimum Balance
The signer account must hold at least the **base reserve** (0.5 XLM) plus enough XLM for each transaction. A balance of at least `SETTLEMENT_SIGNER_BALANCE_WARNING_THRESHOLD` XLM (default: 100) is recommended to cover multiple fee payments.

---

## 5. Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `SETTLEMENT_SIGNER_SECRET_KEY` | *(none — job disabled)* | Secret key for the settlement signer Stellar account |
| `SETTLEMENT_SIGNER_BALANCE_WARNING_THRESHOLD` | `100` | XLM balance at which a warning alert fires |
| `SETTLEMENT_SIGNER_BALANCE_CRITICAL_THRESHOLD` | `20` | XLM balance at which a critical page fires |
| `SETTLEMENT_SIGNER_BALANCE_CHECK_CRON` | `*/15 * * * *` | Cron schedule for the balance check |
