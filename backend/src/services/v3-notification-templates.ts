import {
  V3NotificationEventType,
  V3_EVENT_CLASSIFICATIONS,
  RenderedV3Notification,
  CapThresholdWarningPayload,
  ChannelNearingExhaustionPayload,
  ChannelCloseInitiatedPayload,
  DisputeDetectedPayload,
  DegradedModePayload,
  ReconciliationDeltaPayload,
} from '../types/v3-notifications';

function fmtAmount(value: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function priorityFor(eventType: V3NotificationEventType): RenderedV3Notification['priority'] {
  const severity = V3_EVENT_CLASSIFICATIONS[eventType].severity;
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'high';
    case 'info':
    default:
      return 'normal';
  }
}

function renderCapThresholdWarning(
  payload: CapThresholdWarningPayload,
): RenderedV3Notification {
  const { currentSpend, budgetAmount, percentageUsed, currency, threshold, exceeded } = payload;
  const emoji = exceeded ? '🚨' : '⚠️';
  const title = exceeded
    ? `${emoji} Budget exceeded: ${fmtAmount(currentSpend, currency)} of ${fmtAmount(budgetAmount, currency)}`
    : `${emoji} Budget alert: ${percentageUsed.toFixed(0)}% of ${fmtAmount(budgetAmount, currency)} used`;
  const body = exceeded
    ? `Your monthly subscription spend has exceeded your ${fmtAmount(budgetAmount, currency)} budget by ${fmtAmount(currentSpend - budgetAmount, currency)}.`
    : `Your monthly subscription spend has reached ${percentageUsed.toFixed(0)}% of your ${fmtAmount(budgetAmount, currency)} budget (${fmtAmount(currentSpend, currency)} used, threshold was ${threshold}%).`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,${exceeded ? '#e53e3e' : '#ED8936'} 0%,#764ba2 100%);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">${title}</h1>
  </div>
  <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid ${exceeded ? '#e53e3e' : '#ED8936'};">
      <p style="margin:0 0 8px 0;"><strong>Current spend:</strong> ${fmtAmount(currentSpend, currency)}</p>
      <p style="margin:0 0 8px 0;"><strong>Monthly budget:</strong> ${fmtAmount(budgetAmount, currency)}</p>
      <p style="margin:0 0 8px 0;"><strong>Utilization:</strong> ${percentageUsed.toFixed(1)}%</p>
      <p style="margin:0;"><strong>Alert threshold:</strong> ${threshold}%</p>
    </div>
    <div style="text-align:center;margin:30px 0;">
      <a href="/dashboard" style="background:${exceeded ? '#e53e3e' : '#ED8936'};color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Review subscriptions</a>
    </div>
  </div>
</div>`.trim();
  return { title, body, html, priority: priorityFor('cap_threshold_warning'), url: '/dashboard' };
}

function renderChannelNearingExhaustion(
  payload: ChannelNearingExhaustionPayload,
): RenderedV3Notification {
  const { channelId, currentBalance, averageRenewalAmount, renewalsRemaining, currency, autoTopUpEnabled } = payload;
  const title = `⚠️ Payment channel running low`;
  const body = `Your payment channel (${channelId.slice(0, 8)}…) has balance for ${renewalsRemaining.toFixed(1)} more renewal${renewalsRemaining >= 2 ? 's' : ''} at an average of ${fmtAmount(averageRenewalAmount, currency)}.${autoTopUpEnabled ? ' Auto-top-up is enabled.' : ' Please top up soon to avoid disputes.'}`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#ED8936 0%,#C05621 100%);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">⚠️ Payment channel low on funds</h1>
  </div>
  <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #ED8936;">
      <p style="margin:0 0 8px 0;"><strong>Channel ID:</strong> <code>${channelId}</code></p>
      <p style="margin:0 0 8px 0;"><strong>Current balance:</strong> ${fmtAmount(currentBalance, currency)}</p>
      <p style="margin:0 0 8px 0;"><strong>Avg. renewal cost:</strong> ${fmtAmount(averageRenewalAmount, currency)}</p>
      <p style="margin:0;"><strong>Renewals remaining:</strong> ${renewalsRemaining.toFixed(1)}</p>
    </div>
    ${autoTopUpEnabled
      ? `<p style="color:#2F855A;text-align:center;">✅ Auto-top-up is enabled — the channel will be topped up automatically.</p>`
      : `<div style="text-align:center;margin:30px 0;"><a href="/payment-channels/${channelId}" style="background:#ED8936;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Top up channel</a></div>`
    }
  </div>
</div>`.trim();
  return { title, body, html, priority: priorityFor('channel_nearing_exhaustion'), url: `/payment-channels/${channelId}` };
}

function renderChannelCloseInitiated(
  payload: ChannelCloseInitiatedPayload,
): RenderedV3Notification {
  const { channelId, unilateral, disputeWindowDays, remainingBalance, currency } = payload;
  const emoji = unilateral ? '🚨' : '📢';
  const kind = unilateral ? 'unilateral close' : 'cooperative close';
  const title = `${emoji} Payment channel ${kind} initiated`;
  const body = unilateral
    ? `A unilateral close has been initiated on payment channel ${channelId.slice(0, 8)}…. A ${disputeWindowDays}-day dispute window is open. Remaining balance: ${fmtAmount(remainingBalance, currency)}.`
    : `A cooperative close has been initiated on payment channel ${channelId.slice(0, 8)}…. Remaining balance of ${fmtAmount(remainingBalance, currency)} will be settled on-chain.`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,${unilateral ? '#e53e3e' : '#4299E1'} 0%,#764ba2 100%);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">${title}</h1>
  </div>
  <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid ${unilateral ? '#e53e3e' : '#4299E1'};">
      <p style="margin:0 0 8px 0;"><strong>Channel ID:</strong> <code>${channelId}</code></p>
      <p style="margin:0 0 8px 0;"><strong>Close type:</strong> ${kind}</p>
      <p style="margin:0 0 8px 0;"><strong>Remaining balance:</strong> ${fmtAmount(remainingBalance, currency)}</p>
      <p style="margin:0;"><strong>${unilateral ? 'Dispute window' : 'Settlement'}:</strong> ${unilateral ? disputeWindowDays + ' days' : 'imminent'}</p>
    </div>
    ${unilateral ? `<p style="color:#C53030;text-align:center;">⚠️ Review the dispute window and confirm no newer state needs to be submitted by your watchtower.</p>` : ''}
    <div style="text-align:center;margin:30px 0;">
      <a href="/payment-channels/${channelId}" style="background:${unilateral ? '#e53e3e' : '#4299E1'};color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Inspect channel</a>
    </div>
  </div>
</div>`.trim();
  return { title, body, html, priority: priorityFor('channel_close_initiated'), url: `/payment-channels/${channelId}` };
}

function renderDisputeDetected(
  payload: DisputeDetectedPayload,
): RenderedV3Notification {
  const { channelId, sequenceNumber, cause, currentBalance, currency, userId } = payload;
  const causeLabel = cause === 'unilateral_close' ? 'Unilateral close detected'
    : cause === 'watchtower_challenge' ? 'Watchtower challenge submitted'
    : 'State mismatch reported';
  const title = `🔥 [OPS] Dispute detected — channel ${channelId.slice(0, 8)}…`;
  const body = `[Operator] Dispute detected on channel ${channelId} (user ${userId.slice(0, 8)}…). Cause: ${causeLabel}. Sequence #${sequenceNumber}. Balance at stake: ${fmtAmount(currentBalance, currency)}. Immediate investigation required.`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#9B2C2C;padding:30px;border-radius:10px 10px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">🔥 OPERATOR ALERT: Payment channel dispute</h1>
  </div>
  <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #9B2C2C;">
      <p style="margin:0 0 8px 0;"><strong>Channel ID:</strong> <code>${channelId}</code></p>
      <p style="margin:0 0 8px 0;"><strong>User ID:</strong> <code>${userId}</code></p>
      <p style="margin:0 0 8px 0;"><strong>Cause:</strong> ${causeLabel}</p>
      <p style="margin:0 0 8px 0;"><strong>Sequence #:</strong> ${sequenceNumber}</p>
      <p style="margin:0;"><strong>Balance at stake:</strong> ${fmtAmount(currentBalance, currency)}</p>
    </div>
    <p style="color:#C53030;text-align:center;font-weight:600;">Operator action required — inspect channel state, validate watchtower submissions, and prevent loss of funds.</p>
  </div>
</div>`.trim();
  return { title, body, html, priority: priorityFor('dispute_detected'), url: `/admin/payment-channels/${channelId}` };
}

function renderDegradedMode(
  payload: DegradedModePayload,
  entered: boolean,
): RenderedV3Notification {
  const emoji = entered ? '⚠️' : '✅';
  const title = entered
    ? `⚠️ [OPS] System entered degraded mode`
    : `✅ [OPS] System exited degraded mode — all healthy`;
  const deps = payload.dependencies
    .filter((d) => entered ? d.status !== 'healthy' : true)
    .map((d) => `  • ${d.name}: ${d.status}${d.error ? ` (${d.error})` : ''}`)
    .join('\n');
  const body = entered
    ? `[Operator] The service entered degraded mode at ${fmtDate(payload.timestamp)}.\nUnhealthy/degraded dependencies:\n${deps}`
    : `[Operator] The service returned to fully healthy state at ${fmtDate(payload.timestamp)}. Previous issues have cleared.`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:${entered ? 'linear-gradient(135deg,#D69E2E 0%,#B7791F 100%)' : 'linear-gradient(135deg,#38A169 0%,#276749 100%)'};padding:30px;border-radius:10px 10px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">${emoji} OPERATOR: System ${entered ? 'entered' : 'exited'} degraded mode</h1>
  </div>
  <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid ${entered ? '#D69E2E' : '#38A169'};">
      <p style="margin:0 0 8px 0;"><strong>Timestamp:</strong> ${fmtDate(payload.timestamp)}</p>
      <p style="margin:0 0 8px 0;"><strong>Previous state:</strong> ${payload.previousState}</p>
      <p style="margin:0;"><strong>New state:</strong> ${payload.newState}</p>
    </div>
    <div style="background:white;padding:20px;border-radius:8px;margin:10px 0;">
      <p style="margin:0 0 10px 0;font-weight:600;">Dependencies:</p>
      ${payload.dependencies.map((d) => `
        <div style="padding:6px 0;border-bottom:1px solid #edf2f7;">
          <strong>${d.name}</strong>: <span style="color:${d.status === 'healthy' ? '#2F855A' : d.status === 'degraded' ? '#B7791F' : '#C53030'}">${d.status}</span>
          ${d.error ? `<span style="color:#718096;"> — ${d.error}</span>` : ''}
        </div>
      `).join('')}
    </div>
    <div style="text-align:center;margin:30px 0;">
      <a href="/admin/health" style="background:${entered ? '#D69E2E' : '#38A169'};color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Open health dashboard</a>
    </div>
  </div>
</div>`.trim();
  return { title, body, html, priority: priorityFor(entered ? 'degraded_mode_entered' : 'degraded_mode_exited'), url: '/admin/health' };
}

function renderReconciliationDelta(
  payload: ReconciliationDeltaPayload,
): RenderedV3Notification {
  const { runId, totalMismatches, mismatchesByType, tolerance, matched, totalContractEvents, totalRenewalRecords } = payload;
  const pctMismatched = totalContractEvents > 0 ? (totalMismatches / totalContractEvents) * 100 : 0;
  const title = `🔴 [OPS] Reconciliation delta ${pctMismatched.toFixed(2)}% exceeds tolerance of ${tolerance}%`;
  const body = `[Operator] Reconciliation run ${runId.slice(0, 8)}… detected ${totalMismatches} mismatches (${pctMismatched.toFixed(2)}% of ${totalContractEvents} events). Tolerance: ${tolerance}%. Missing from history: ${mismatchesByType.missing_from_history}, orphan events: ${mismatchesByType.orphan_event}, hash mismatches: ${mismatchesByType.hash_mismatch}. Matched: ${matched}/${totalRenewalRecords} renewal records.`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#742A2A;padding:30px;border-radius:10px 10px 0 0;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">🔴 OPERATOR: Reconciliation out of tolerance</h1>
  </div>
  <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #742A2A;">
      <p style="margin:0 0 8px 0;"><strong>Run ID:</strong> <code>${runId}</code></p>
      <p style="margin:0 0 8px 0;"><strong>Mismatches:</strong> ${totalMismatches} (${pctMismatched.toFixed(2)}% of events)</p>
      <p style="margin:0;"><strong>Tolerance:</strong> ${tolerance}%</p>
    </div>
    <div style="background:white;padding:20px;border-radius:8px;margin:10px 0;">
      <p style="margin:0 0 10px 0;font-weight:600;">Breakdown:</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div><strong>Events scanned:</strong> ${totalContractEvents}</div>
        <div><strong>Records matched:</strong> ${matched}</div>
        <div><strong>Missing history:</strong> <span style="color:#C53030;">${mismatchesByType.missing_from_history}</span></div>
        <div><strong>Orphan events:</strong> <span style="color:#C53030;">${mismatchesByType.orphan_event}</span></div>
        <div><strong>Hash mismatches:</strong> <span style="color:#C53030;">${mismatchesByType.hash_mismatch}</span></div>
        <div><strong>Renewal records:</strong> ${totalRenewalRecords}</div>
      </div>
    </div>
    <p style="color:#C53030;text-align:center;font-weight:600;">Operator action required — investigate mismatches and repair if auto-repair is disabled.</p>
    <div style="text-align:center;margin:30px 0;">
      <a href="/admin/reconciliation/${runId}" style="background:#742A2A;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Inspect run</a>
    </div>
  </div>
</div>`.trim();
  return { title, body, html, priority: priorityFor('reconciliation_delta_outside_tolerance'), url: `/admin/reconciliation/${runId}` };
}

export function renderV3Notification(
  eventType: V3NotificationEventType,
  payload: any,
): RenderedV3Notification {
  switch (eventType) {
    case 'cap_threshold_warning':
      return renderCapThresholdWarning(payload as CapThresholdWarningPayload);
    case 'channel_nearing_exhaustion':
      return renderChannelNearingExhaustion(payload as ChannelNearingExhaustionPayload);
    case 'channel_close_initiated':
      return renderChannelCloseInitiated(payload as ChannelCloseInitiatedPayload);
    case 'dispute_detected':
      return renderDisputeDetected(payload as DisputeDetectedPayload);
    case 'degraded_mode_entered':
      return renderDegradedMode(payload as DegradedModePayload, true);
    case 'degraded_mode_exited':
      return renderDegradedMode(payload as DegradedModePayload, false);
    case 'reconciliation_delta_outside_tolerance':
      return renderReconciliationDelta(payload as ReconciliationDeltaPayload);
    default:
      return {
        title: 'SYNCRO notification',
        body: 'A system notification was generated.',
        priority: 'normal',
      };
  }
}

export function renderV3Telegram(
  eventType: V3NotificationEventType,
  payload: any,
): string {
  const r = renderV3Notification(eventType, payload);
  const severity = V3_EVENT_CLASSIFICATIONS[eventType].severity;
  const badge = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🔵';
  return `${badge} <b>${r.title.replace(/^[🚨⚠️📢🔥✅🔴]+ /, '')}</b>\n\n${r.body}`;
}

export function renderV3Slack(
  eventType: V3NotificationEventType,
  payload: any,
): { text: string; blocks: Array<Record<string, unknown>> } {
  const r = renderV3Notification(eventType, payload);
  const severity = V3_EVENT_CLASSIFICATIONS[eventType].severity;
  const color = severity === 'critical' ? '#9B2C2C' : severity === 'warning' ? '#D69E2E' : '#2B6CB0';
  return {
    text: `${r.title} — ${r.body}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: r.title } },
      { type: 'section', text: { type: 'mrkdwn', text: r.body } },
      r.url
        ? { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open dashboard' }, url: r.url, style: severity === 'critical' ? 'danger' : 'primary' }] }
        : null,
    ].filter(Boolean) as Array<Record<string, unknown>>,
  };
}
