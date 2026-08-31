import { env } from '../config/env';
import type { MonthlyDigestSummary, UpcomingRenewal, PriceChange, DigestAlert } from '../types/digest';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

function spendArrow(diff: number): string {
  if (diff > 0) return '▲';
  if (diff < 0) return '▼';
  return '—';
}

function spendColor(diff: number): string {
  if (diff > 0) return '#E86A33';
  if (diff < 0) return '#007A5C';
  return '#6B7280';
}

function severityColor(severity: string): string {
  if (severity === 'critical') return '#E86A33';
  if (severity === 'warning')  return '#FFD166';
  return '#6B7280';
}

function severityBg(severity: string): string {
  if (severity === 'critical') return '#FEF3ED';
  if (severity === 'warning')  return '#FFFBEB';
  return '#F9FAFB';
}

function severityIcon(severity: string): string {
  if (severity === 'critical') return '🚨';
  if (severity === 'warning')  return '⚠️';
  return 'ℹ️';
}

// ─── Section builders ─────────────────────────────────────────────────────────

function renewalsTable(renewals: UpcomingRenewal[], currency: string): string {
  if (renewals.length === 0) {
    return `<p style="color:#6B7280;font-size:14px;margin:0;">No renewals in the next 30 days.</p>`;
  }

  const rows = renewals
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #F3F4F6;font-size:14px;color:#1E2A35;">
          ${r.name}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #F3F4F6;font-size:14px;color:#1E2A35;text-align:right;white-space:nowrap;">
          ${fmt(r.price, currency)}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #F3F4F6;font-size:14px;color:#6B7280;text-align:right;white-space:nowrap;">
          ${fmtDate(r.renewalDate)}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #F3F4F6;font-size:12px;text-align:right;white-space:nowrap;">
          <span style="
            background:${r.daysUntilRenewal <= 5 ? '#FEF3ED' : '#F0FDF4'};
            color:${r.daysUntilRenewal <= 5 ? '#E86A33' : '#007A5C'};
            padding:2px 8px;border-radius:12px;font-weight:600;">
            ${r.daysUntilRenewal}d
          </span>
        </td>
      </tr>`,
    )
    .join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr style="background:#F9F6F2;">
          <th style="padding:8px;text-align:left;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Service</th>
          <th style="padding:8px;text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Amount</th>
          <th style="padding:8px;text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Date</th>
          <th style="padding:8px;text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">In</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function alertsSection(alerts: DigestAlert[], dashboardUrl: string): string {
  if (alerts.length === 0) return '';

  const items = alerts
    .map(
      (a) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:32px;vertical-align:middle;font-size:18px;">${severityIcon(a.severity)}</td>
              <td style="vertical-align:middle;">
                <p style="margin:0;font-size:14px;font-weight:600;color:#1E2A35;">${a.name}</p>
                <p style="margin:2px 0 0;font-size:13px;color:#6B7280;">${a.message}</p>
              </td>
              <td style="width:80px;text-align:right;vertical-align:middle;">
                <span style="
                  background:${severityBg(a.severity)};
                  color:${severityColor(a.severity)};
                  padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;
                  text-transform:uppercase;letter-spacing:0.5px;">
                  ${a.severity}
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>`,
    )
    .join('');

  return `
    <!-- ALERTS -->
    <tr><td style="padding:0 0 24px;">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1E2A35;">⚠️ Needs Attention</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #F3F4F6;border-radius:8px;overflow:hidden;">
        <tbody>${items}</tbody>
      </table>
      <div style="text-align:right;margin-top:8px;">
        <a href="${dashboardUrl}/dashboard" style="font-size:12px;color:#1E2A35;text-decoration:underline;">
          Resolve in dashboard →
        </a>
      </div>
    </td></tr>`;
}

function priceChangesSection(changes: PriceChange[], currency: string): string {
  if (changes.length === 0) return '';

  const items = changes
    .map((c) => {
      const up   = c.delta > 0;
      const sign = up ? '+' : '';
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #F3F4F6;font-size:14px;color:#1E2A35;">${c.name}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #F3F4F6;font-size:14px;color:#6B7280;text-decoration:line-through;text-align:right;">
            ${fmt(c.oldPrice, currency)}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #F3F4F6;font-size:14px;text-align:right;white-space:nowrap;">
            <span style="color:#1E2A35;font-weight:600;">${fmt(c.newPrice, currency)}</span>
            <span style="
              margin-left:6px;
              color:${up ? '#E86A33' : '#007A5C'};
              font-size:12px;font-weight:600;">
              ${sign}${fmt(c.delta, currency)}/mo
            </span>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <!-- PRICE CHANGES -->
    <tr><td style="padding:0 0 24px;">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1E2A35;">💰 Price Changes Detected</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #F3F4F6;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#F9F6F2;">
            <th style="padding:8px;text-align:left;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Service</th>
            <th style="padding:8px;text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Was</th>
            <th style="padding:8px;text-align:right;font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Now</th>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>
    </td></tr>`;
}

// ─── Main template ─────────────────────────────────────────────────────────────

export function buildDigestEmailHtml(
  summary: MonthlyDigestSummary,
  dashboardUrl: string = env.FRONTEND_URL,
): string {
  const {
    userFullName,
    periodLabel,
    totalMonthlySpend,
    spendDifference,
    spendDifferencePercent,
    yearToDateSpend,
    renewalsCount,
    upcomingRenewals,
    priceChanges,
    alerts,
    currency,
  } = summary;

  const greeting = userFullName ? `Hi ${userFullName.split(' ')[0]},` : 'Hi there,';
  const diffAbs   = Math.abs(spendDifference);
  const diffSign  = spendDifference > 0 ? '+' : spendDifference < 0 ? '−' : '';
  const diffPct   = Math.abs(spendDifferencePercent).toFixed(1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your SYNCRO Monthly Summary — ${periodLabel}</title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#F9F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

<!-- PREHEADER (hidden preview text) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
  Your ${periodLabel} subscription summary — ${fmt(totalMonthlySpend, currency)} total spend, ${renewalsCount} upcoming renewal${renewalsCount !== 1 ? 's' : ''}.&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<!-- WRAPPER -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F6F2;padding:32px 16px;">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- ── HEADER ── -->
        <tr>
          <td style="background:#1E2A35;border-radius:12px 12px 0 0;padding:32px 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0 0 4px;font-size:12px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;font-weight:600;">SYNCRO</p>
                  <h1 style="margin:0;font-size:22px;font-weight:700;color:#FFFFFF;line-height:1.3;">
                    Monthly Summary
                  </h1>
                  <p style="margin:4px 0 0;font-size:15px;color:#FFD166;font-weight:600;">${periodLabel}</p>
                </td>
                <td style="text-align:right;vertical-align:top;">
                  <span style="font-size:36px;">📊</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── BODY ── -->
        <tr>
          <td style="background:#FFFFFF;border-radius:0 0 12px 12px;padding:32px;">
            <table width="100%" cellpadding="0" cellspacing="0">

              <!-- Greeting -->
              <tr><td style="padding:0 0 24px;">
                <p style="margin:0;font-size:15px;color:#4B5563;">
                  ${greeting}<br>
                  Here's your subscription overview for ${periodLabel}.
                </p>
              </td></tr>

              <!-- ── SPEND SUMMARY CARDS ── -->
              <tr><td style="padding:0 0 28px;">
                <!--[if mso]><table width="100%" cellpadding="0" cellspacing="8"><tr><![endif]-->
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <!-- Card: Total spend -->
                    <td style="width:33%;padding-right:8px;vertical-align:top;">
                      <!--[if mso]><td width="180" valign="top"><![endif]-->
                      <div style="background:#F9F6F2;border-radius:8px;padding:16px;text-align:center;">
                        <p style="margin:0 0 4px;font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Total Spend</p>
                        <p style="margin:0;font-size:22px;font-weight:700;color:#1E2A35;">${fmt(totalMonthlySpend, currency)}</p>
                        <p style="margin:4px 0 0;font-size:11px;color:#9CA3AF;">this month</p>
                      </div>
                    </td>
                    <!-- Card: vs last month -->
                    <td style="width:33%;padding:0 4px;vertical-align:top;">
                      <div style="background:#F9F6F2;border-radius:8px;padding:16px;text-align:center;">
                        <p style="margin:0 0 4px;font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">vs Last Month</p>
                        <p style="margin:0;font-size:22px;font-weight:700;color:${spendColor(spendDifference)};">
                          ${spendArrow(spendDifference)}&nbsp;${fmt(diffAbs, currency)}
                        </p>
                        <p style="margin:4px 0 0;font-size:11px;color:#9CA3AF;">${diffSign}${diffPct}%</p>
                      </div>
                    </td>
                    <!-- Card: Renewals -->
                    <td style="width:33%;padding-left:8px;vertical-align:top;">
                      <div style="background:#F9F6F2;border-radius:8px;padding:16px;text-align:center;">
                        <p style="margin:0 0 4px;font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Renewals</p>
                        <p style="margin:0;font-size:22px;font-weight:700;color:#1E2A35;">${renewalsCount}</p>
                        <p style="margin:4px 0 0;font-size:11px;color:#9CA3AF;">next 30 days</p>
                      </div>
                    </td>
                  </tr>
                </table>
                <!--[if mso]></table><![endif]-->
              </td></tr>

              <!-- ── UPCOMING RENEWALS ── -->
              <tr><td style="padding:0 0 28px;">
                <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1E2A35;">🔔 Upcoming Renewals</h2>
                ${renewalsTable(upcomingRenewals, currency)}
                <div style="text-align:right;margin-top:8px;">
                  <a href="${dashboardUrl}/dashboard" style="font-size:12px;color:#1E2A35;text-decoration:underline;">
                    View all upcoming →
                  </a>
                </div>
              </td></tr>

              ${alertsSection(alerts, dashboardUrl)}

              ${priceChangesSection(priceChanges, currency)}

              <!-- ── YEAR-TO-DATE ── -->
              <tr><td style="padding:0 0 28px;">
                <div style="background:#1E2A35;border-radius:8px;padding:16px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin:0;font-size:12px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Year to Date (${new Date().getFullYear()})</p>
                        <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#FFD166;">${fmt(yearToDateSpend, currency)}</p>
                      </td>
                      <td style="text-align:right;vertical-align:middle;">
                        <span style="font-size:28px;">📅</span>
                      </td>
                    </tr>
                  </table>
                </div>
              </td></tr>

              <!-- ── CTA ── -->
              <tr><td style="padding:0 0 8px;text-align:center;">
                <a href="${dashboardUrl}/dashboard"
                   style="display:inline-block;background:#FFD166;color:#1E2A35;font-size:14px;font-weight:700;
                          padding:12px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.3px;">
                  View Full Dashboard →
                </a>
              </td></tr>

            </table>
          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td style="padding:24px 0 8px;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#9CA3AF;">
              You're receiving this because you opted in to monthly digests.
            </p>
            <p style="margin:0;font-size:12px;color:#9CA3AF;">
              <a href="${dashboardUrl}/dashboard?tab=settings" style="color:#6B7280;text-decoration:underline;">Manage preferences</a>
              &nbsp;·&nbsp;
              <a href="${dashboardUrl}/unsubscribe-digest" style="color:#6B7280;text-decoration:underline;">Unsubscribe</a>
            </p>
            <p style="margin:12px 0 0;font-size:11px;color:#D1D5DB;">© ${new Date().getFullYear()} SYNCRO. All rights reserved.</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// ─── Plain-text fallback ──────────────────────────────────────────────────────

export function buildDigestEmailText(
  summary: MonthlyDigestSummary,
  dashboardUrl: string = env.FRONTEND_URL,
): string {
  const {
    userFullName,
    periodLabel,
    totalMonthlySpend,
    spendDifference,
    renewalsCount,
    upcomingRenewals,
    priceChanges,
    alerts,
    yearToDateSpend,
    currency,
  } = summary;

  const greeting = userFullName ? `Hi ${userFullName.split(' ')[0]},` : 'Hi there,';
  const diffSign  = spendDifference >= 0 ? '+' : '−';
  const lines: string[] = [
    `SYNCRO Monthly Summary — ${periodLabel}`,
    '='.repeat(44),
    '',
    greeting,
    `Here's your subscription overview for ${periodLabel}.`,
    '',
    '─── SPEND SUMMARY ───',
    `📊 Total Monthly Spend : ${fmt(totalMonthlySpend, currency)}`,
    `📈 vs Last Month       : ${diffSign}${fmt(Math.abs(spendDifference), currency)}`,
    `🔔 Renewals This Month : ${renewalsCount} subscription${renewalsCount !== 1 ? 's' : ''}`,
    `📅 Year to Date        : ${fmt(yearToDateSpend, currency)}`,
    '',
  ];

  if (upcomingRenewals.length > 0) {
    lines.push('─── UPCOMING RENEWALS (NEXT 30 DAYS) ───');
    for (const r of upcomingRenewals) {
      lines.push(`• ${r.name} — ${fmt(r.price, currency)} — ${fmtDate(r.renewalDate)} (in ${r.daysUntilRenewal}d)`);
    }
    lines.push('');
    lines.push(`View all: ${dashboardUrl}/dashboard`);
    lines.push('');
  }

  if (alerts.length > 0) {
    lines.push('─── NEEDS ATTENTION ───');
    for (const a of alerts) {
      lines.push(`${severityIcon(a.severity)} ${a.name}: ${a.message}`);
    }
    lines.push(`Resolve: ${dashboardUrl}/dashboard`);
    lines.push('');
  }

  if (priceChanges.length > 0) {
    lines.push('─── PRICE CHANGES DETECTED ───');
    for (const c of priceChanges) {
      const sign = c.delta >= 0 ? '+' : '−';
      lines.push(`• ${c.name}: ${fmt(c.oldPrice, currency)} → ${fmt(c.newPrice, currency)} (${sign}${fmt(Math.abs(c.delta), currency)}/mo)`);
    }
    lines.push('');
  }

  lines.push('─'.repeat(44));
  lines.push(`Manage preferences: ${dashboardUrl}/dashboard?tab=settings`);
  lines.push(`Unsubscribe: ${dashboardUrl}/unsubscribe-digest`);

  return lines.join('\n');
}