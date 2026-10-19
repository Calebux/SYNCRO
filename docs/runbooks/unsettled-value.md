# Runbook: Unsettled Value Alert

Unsettled value is the amount metered but not yet settled on-chain. It is
SYNCRO's exposure if a payer disappears. Watch it per channel and in total.

## Signals

- Metric: `syncro_unsettled_value_per_channel{channel_id,user_id,provider}` — unsettled cents per active/closing channel.
- Metric: `syncro_unsettled_value_total` — total unsettled cents across all channels.
- Alerts (Slack `#syncro-oncall`, 5-min cooldown):
  - `high_unsettled_value` (critical) — a channel is ≥50% of its size or above `UNSETTLED_PER_CHANNEL_THRESHOLD`.
  - `unsettled_value_total_exceeded` (critical) — total above `UNSETTLED_TOTAL_THRESHOLD`.
  - `rising_unsettled_value` (warning) — total up ≥20% in an hour.

## Response

1. Confirm scope: `GET /metrics | grep syncro_unsettled_value` — note which `provider` labels are elevated and whether the total is breached.
2. If a single channel is hot: check its `last_settled_at` / channel age; force a settlement flush for that channel, then watch the metric drain.
3. If the total is breached: treat as systemic — pause new metered calls, force-settle oldest channels first, and do not resume until the total is back under threshold.
4. If settlement stays blocked, escalate to the settlement-stalled path in `docs/runbooks/incident-runbooks.md` (R2).
5. After recovery, verify both the per-channel and total gauges return below threshold for two consecutive 5-minute checks before closing the incident.
