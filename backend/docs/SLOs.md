# Paid-Call Path SLOs and Error Budgets

> **Issue #1515 · Area: ops · Priority: P1**
> This document defines the Service Level Objectives (SLOs), error budgets, and alerting policies for the paid-call path.

---

## Table of Contents

1. [Overview](#overview)
2. [SLO Definitions](#slo-definitions)
3. [Error Budgets](#error-budgets)
4. [Alerting Policies](#alerting-policies)
5. [What Exhausting an Error Budget Means for Shipping](#what-exhausting-an-error-budget-means-for-shipping)
6. [Metrics Reference](#metrics-reference)

---

## Overview

The health of the SYNCRO system is not "is the server up" — it is whether **paid calls are being admitted, metered, and settled correctly**. The paid-call path is the sequence of steps a request takes from identity resolution through on-chain settlement:

```
resolveIdentity → resolveRouteAndPrice → checkScope → checkCap → verifyPayment → reserveMeter → proxyAndCommit → settle
```

This document defines SLOs for the three most user-facing aspects of this path, the error budgets that govern them, and the alerting policies for money-related metrics.

---

## SLO Definitions

### 1. Admission Availability

| Field | Value |
|-------|-------|
| **SLO** | ≥ 99.9% of paid requests are admitted (not rejected for system reasons) |
| **SLI** | `admission_rejections_by_reason.total` divided by total paid requests |
| **Window** | Rolling 24 hours |
| **Measurement** | `(total_requests - unauthenticated - missing_scope - cap_exceeded - invalid_payment_proof - meter_reserve_failed - upstream_error) / total_requests` |

**Exclusions from availability calculations:**
- Rejections where the user has exceeded their cap (`cap_exceeded`) are considered user-side and do not count against the SLO.
- Rejections where the payment proof is invalid (`invalid_payment_proof`) are considered user-side and do not count against the SLO.
- Rejections due to missing scope (`missing_scope`) are considered user-side and do not count against the SLO.

**System-side rejections that count against the SLO:**
- `unauthenticated` — system failed to resolve identity
- `meter_reserve_failed` — meter reserve failed due to system error
- `upstream_error` — upstream proxy failed due to system error

### 2. Admission Latency

| Field | Value |
|-------|-------|
| **SLO** | p99 admission latency ≤ 500ms |
| **SLI** | `admission_latency_by_step_ms` (per-step p99) |
| **Window** | Rolling 24 hours |
| **Measurement** | p99 of the total admission latency across all steps |

**Per-step latency budgets (must sum to ≤ 500ms p99):**

| Step | Budget |
|------|--------|
| `identityResolutionMs` | ≤ 100ms |
| `scopeReadMs` | ≤ 50ms |
| `capCheckMs` | ≤ 50ms |
| `meterReserveMs` | ≤ 300ms |

### 3. Settlement Completion

| Field | Value |
|-------|-------|
| **SLO** | ≥ 99.5% of metered value is settled on-chain within 24 hours |
| **SLI** | `settlement_submission.submissionSuccessRatePct` and `unsettled_value_per_channel` |
| **Window** | Rolling 24 hours |
| **Measurement** | `successful_submissions / total_submissions` for settlement submissions |

**Unsettled value threshold:**
- Any channel with `unsettledValue > 0` for more than 24 hours triggers an alert.
- Any channel with `unsettledValue > channelSize * 0.5` (50% of channel size) triggers a critical alert.

---

## Error Budgets

| SLO | Target | Error Budget (24h) | Budget Consumption Rate |
|-----|--------|--------------------|------------------------|
| Admission Availability | 99.9% | 0.1% of requests = ~0.1% × total_requests | Burns 1% of budget per 0.001% miss |
| Admission Latency (p99) | ≤ 500ms | 0.1% of requests exceeding 500ms | Burns 1% of budget per 0.001% excess |
| Settlement Completion | 99.5% | 0.5% of settlements failing within 24h | Burns 1% of budget per 0.005% miss |

### Error Budget Calculation

For a rolling 28-day window (the standard Google SRE approach adapted to our 24h measurement):

```
error_budget = (1 - slo_target) × total_requests_in_window
budget_remaining = error_budget - errors_observed
budget_burn_rate = errors_observed / error_budget
```

---

## Alerting Policies

### Money-Related Alerts (Route to a Human)

The following alerts represent **money at risk** and must route to a human (on-call engineer via Slack/PagerDuty):

| Alert | Condition | Severity | Route To |
|-------|-----------|----------|----------|
| **High Unsettled Value** | `unsettled_value_per_channel` for any channel exceeds `channelSize * 0.5` for > 1 hour | 🔴 Critical | `#syncro-oncall` Slack channel |
| **Rising Unsettled Value** | Total unsettled value across all channels increases by > 20% in 1 hour | 🟠 Warning | `#syncro-oncall` Slack channel |
| **Reconciliation Delta Outside Tolerance** | `reconciliation_delta.totalDelta > 0` and `channelsOutOfTolerance > 0` | 🔴 Critical | `#syncro-oncall` Slack channel |
| **Reconciliation Blocked** | `reconciliation_delta.blocked = true` (settlement batch blocked) | 🔴 Critical | `#syncro-oncall` Slack channel |
| **Meter Reserve Failure Spike** | `meter_reserve_failures` > 10 in 5 minutes | 🟠 Warning | `#syncro-oncall` Slack channel |
| **Meter Commit Failure Spike** | `meter_commit_failures` > 10 in 5 minutes | 🟠 Warning | `#syncro-oncall` Slack channel |
| **Settlement Submission Failure** | `settlement_submission.successRatePct < 95%` over 1 hour | 🟠 Warning | `#syncro-oncall` Slack channel |
| **Indexer Lag** | `indexer_lag_blocks > 10` (50+ seconds behind) | 🟡 Warning | `#syncro-ops` Slack channel |

### Alert Delivery

All money-related alerts are sent via:
1. **Slack** to `#syncro-oncall` (critical) or `#syncro-ops` (warning)
2. **V3 Notification Dispatch** with event type `reconciliation_delta_outside_tolerance` for reconciliation alerts
3. **Email** to the on-call distribution list for critical alerts

---

## What Exhausting an Error Budget Means for Shipping

### Policy

When the error budget for any SLO is **exhausted** (budget burn rate ≥ 100%), the following actions are triggered:

1. **Immediate Freeze on Non-Critical Deployments**
   - No feature-flagged rollouts to paid-call paths
   - No config changes that affect admission, metering, or settlement
   - Only P0/P1 hotfixes are allowed through the deployment pipeline

2. **Incident Response**
   - The on-call engineer is paged immediately
   - A post-mortem is required within 48 hours
   - The incident is reviewed in the next sprint retrospective

3. **Root Cause Analysis Required**
   - Before the error budget is replenished (24 hours after budget exhaustion), a root cause analysis must be filed
   - The RCA must identify the specific change or configuration that caused the budget exhaustion
   - A remediation plan must be approved by the engineering lead

4. **Gradual Reopening**
   - After the RCA is filed and approved, deployments can resume at 50% of normal velocity
   - Full velocity is restored after 24 hours of stable metrics (budget burn rate < 50%)

### Budget Replenishment

- Error budgets replenish at a rate of `1/30` of the monthly budget per day (rolling 30-day window)
- A single day's exhaustion does not permanently close the budget, but repeated exhaustion within a 7-day window triggers a mandatory engineering review

---

## Metrics Reference

### Admission Latency by Step

Exported as `syncro_admission_latency_by_step_ms` with labels `step` and `quantile` (p50, p95, p99).

### Admission Rejections by Reason

Exported as `syncro_admission_rejections_total` with label `reason` (unauthenticated, missing_scope, cap_exceeded, invalid_payment_proof, meter_reserve_failed, upstream_error, total).

### Meter Reserve and Commit Rates

Exported as:
- `syncro_meter_reserve_success_rate_pct`
- `syncro_meter_commit_success_rate_pct`
- `syncro_meter_reserve_failures_total`
- `syncro_meter_commit_failures_total`
- `syncro_meter_total_reserves_total`
- `syncro_meter_total_commits_total`

### Unsettled Value per Channel

Exported as `syncro_unsettled_value_per_channel` with labels `channel_id` and `user_id`.

### Settlement Submission Success Rate

Exported as `syncro_settlement_submission_success_rate_pct`.

### Indexer Lag

Exported as:
- `syncro_indexer_lag_ms` — lag in milliseconds (approximate, based on 5s per Stellar ledger)
- `syncro_indexer_lag_blocks` — lag in Stellar ledgers

### Reconciliation Delta

Exported as:
- `syncro_reconciliation_delta_total` — total delta across all channels
- `syncro_reconciliation_channels_out_of_tolerance` — number of channels with delta outside tolerance
- `syncro_reconciliation_blocked` — 1 if settlement batching is blocked, 0 otherwise
