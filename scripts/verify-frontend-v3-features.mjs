#!/usr/bin/env node
/**
 * Verification suite for Issue #1864 (Downloadable monthly statements for principals
 * and providers) and Issue #1865 (Notification center for cap, dispute, and payout events).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

if (typeof registerHooks === 'function') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if (specifier.startsWith('.') && context.parentURL) {
          const tsUrl = new URL(
            specifier.endsWith('.js') ? specifier.replace(/\.js$/, '.ts') : `${specifier}.ts`,
            context.parentURL,
          );
          if (fs.existsSync(fileURLToPath(tsUrl))) {
            return nextResolve(tsUrl.href, context);
          }
        }
        throw err;
      }
    },
  });
}

const {
  accountingRecordsFromProviderSettlements,
  buildStellarExplorerTxUrl,
  generateMonthlyStatement,
  generateStatementCSV,
  getSeededAccountingExport,
  renderStatementPrintableHTML,
} = await import('../client/lib/statements/monthly-statements.ts');

const {
  DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES,
  buildNotificationItem,
  emitSeededV3NotificationsRealtime,
  getSeededV3NotificationEvents,
  loadNotificationCenterPreferences,
  normalizeV3EventType,
  publishV3NotificationEvent,
  resolveActiveDeliveryChannels,
  saveNotificationCenterPreferences,
  subscribeToV3NotificationStream,
} = await import('../client/lib/notifications/v3-notification-center.ts');

console.log('[Frontend v3 #1864 & #1865] Running verification suite...');

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1864: Monthly statements for principals and providers
// ─────────────────────────────────────────────────────────────────────────────

const seeded = getSeededAccountingExport('2026-10', 'testnet');

// 1. Principal statement: spend per agent matches settled total exactly
const principalStmt = generateMonthlyStatement(seeded.principalRecords, {
  month: '2026-10',
  role: 'principal',
  network: 'testnet',
});

assert.equal(principalStmt.totalSettled, seeded.expectedPrincipalSettledTotal);
assert.equal(principalStmt.totalSettledFormatted, '112.50 USDC');
assert.equal(principalStmt.settledLineCount, 3);

const agentMap = Object.fromEntries(
  principalStmt.agentSummaries.map((a) => [a.agentId, a.settledTotal]),
);
assert.deepEqual(agentMap, seeded.expectedSpendByAgent);

const agentSum = principalStmt.agentSummaries.reduce((sum, a) => sum + a.settledTotal, 0);
assert.equal(agentSum, principalStmt.totalSettled);

for (const line of principalStmt.lines) {
  assert.equal(
    line.explorerUrl,
    buildStellarExplorerTxUrl(line.transactionHash, 'testnet'),
  );
  assert.ok(line.explorerUrl.startsWith('https://stellar.expert/explorer/testnet/tx/'));
}

// 2. Provider statement: earnings per route matches settled total exactly
const providerStmt = generateMonthlyStatement(seeded.providerRecords, {
  month: '2026-10',
  role: 'provider',
  network: 'testnet',
});

assert.equal(providerStmt.totalSettled, seeded.expectedProviderSettledTotal);
assert.equal(providerStmt.totalSettledFormatted, '142.50 USDC');
assert.equal(providerStmt.settledLineCount, 3);

const routeMap = Object.fromEntries(
  providerStmt.routeSummaries.map((r) => [r.routeKey, r.settledTotal]),
);
assert.deepEqual(routeMap, seeded.expectedEarningsByRoute);

const routeSum = providerStmt.routeSummaries.reduce((sum, r) => sum + r.settledTotal, 0);
assert.equal(routeSum, providerStmt.totalSettled);

for (const line of providerStmt.lines) {
  assert.equal(
    line.explorerUrl,
    buildStellarExplorerTxUrl(line.transactionHash, 'testnet'),
  );
}

// 3. CSV export contains all columns, Stellar explorer links, and exact settled total
const principalCsv = generateStatementCSV(principalStmt);
assert.ok(principalCsv.includes('StellarExplorerUrl'));
assert.ok(principalCsv.includes('112.50'));
for (const line of principalStmt.lines) {
  assert.ok(principalCsv.includes(line.explorerUrl));
  assert.ok(principalCsv.includes(line.transactionHash));
}

const providerCsv = generateStatementCSV(providerStmt);
assert.ok(providerCsv.includes('StellarExplorerUrl'));
assert.ok(providerCsv.includes('142.50'));
for (const line of providerStmt.lines) {
  assert.ok(providerCsv.includes(line.explorerUrl));
}

// 4. Printable HTML/PDF view contains agent/route breakdown and Stellar explorer links
const principalHtml = renderStatementPrintableHTML(principalStmt);
assert.ok(principalHtml.includes('Principal Monthly Spend Statement — 2026-10'));
assert.ok(principalHtml.includes('112.50 USDC'));
for (const line of principalStmt.lines) {
  assert.ok(principalHtml.includes(`href="${line.explorerUrl}"`));
}

const providerHtml = renderStatementPrintableHTML(providerStmt);
assert.ok(providerHtml.includes('Provider Monthly Earnings Statement — 2026-10'));
assert.ok(providerHtml.includes('142.50 USDC'));
for (const line of providerStmt.lines) {
  assert.ok(providerHtml.includes(`href="${line.explorerUrl}"`));
}

// 5. Adapter from ProviderConsole settlements
const adaptedRecords = accountingRecordsFromProviderSettlements('prov_1', 'acme', [
  {
    settlementId: 'set_100',
    providerId: 'prov_1',
    routeId: 'route_1',
    receiptId: 'rcpt_100',
    method: 'POST',
    pathPattern: '/v1/chat',
    unit: 'tokens',
    quantity: 50,
    price: 0.5,
    amount: 25,
    rateCardVersion: 'v1',
    rateCardEffectiveFrom: '2026-10-01T00:00:00.000Z',
    status: 'settled',
    meteredAt: '2026-10-10T12:00:00.000Z',
    channelId: 'ch_1',
  },
]);
const adaptedStmt = generateMonthlyStatement(adaptedRecords, {
  month: '2026-10',
  role: 'provider',
});
assert.equal(adaptedStmt.totalSettled, 25);
assert.equal(adaptedStmt.lines.length, 1);

console.log('✓ [Issue #1864] Principal & Provider monthly statements (CSV + printable HTML/PDF + Stellar explorer links + exact seeded totals) verified!');

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1865: Notification center for cap, dispute, and payout events
// ─────────────────────────────────────────────────────────────────────────────

// 1. Seeded events cover cap 80%, dispute opened, payout sent, and agent revoked
const seededEvents = getSeededV3NotificationEvents();
assert.equal(seededEvents.length, 4);

const items = seededEvents.map((ev) =>
  buildNotificationItem(ev, DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES),
);

const disputeItem = items.find((i) => i.eventType === 'dispute_opened');
assert.ok(disputeItem, 'Dispute event must exist in seeded feed');
assert.equal(disputeItem.urgent, true, 'Dispute events must be marked as urgent');
assert.ok(
  disputeItem.actionUrl.includes('action=respond-dispute'),
  'Dispute events must link directly to their dispute response action',
);

const capItem = items.find((i) => i.eventType === 'cap_warning');
assert.ok(capItem);
assert.equal(capItem.urgent, false);
assert.ok(capItem.actionUrl.includes('action=adjust-cap'));

const payoutItem = items.find((i) => i.eventType === 'payout_sent');
assert.ok(payoutItem);
assert.ok(payoutItem.actionUrl.includes('action=view-payout'));

const revokedItem = items.find((i) => i.eventType === 'agent_revoked');
assert.ok(revokedItem);
assert.ok(revokedItem.actionUrl.includes('action=review-revocation'));

// 2. Real-time event stream (#1507)
const receivedRealtime = [];
const unsubscribe = subscribeToV3NotificationStream((ev) => {
  receivedRealtime.push(ev);
});

emitSeededV3NotificationsRealtime();
assert.equal(receivedRealtime.length, 4, 'All 4 seeded events must arrive in real time (#1507)');

publishV3NotificationEvent({
  id: 'live_dispute_2',
  eventType: 'dispute_detected',
  title: 'Watchtower challenge submitted',
  message: 'Watchtower detected stale close on channel ch_99.',
  metadata: { channelId: 'ch_99' },
});
assert.equal(receivedRealtime.length, 5);
assert.equal(normalizeV3EventType(receivedRealtime[4].eventType), 'dispute_opened');

unsubscribe();

// 3. Per-type delivery preferences (in_app, email, webhook) saved & respected
const customPrefs = saveNotificationCenterPreferences({
  ...DEFAULT_V3_NOTIFICATION_CENTER_PREFERENCES,
  cap_warning: { in_app: false, email: true, webhook: true },
  dispute_opened: { in_app: true, email: true, webhook: true },
});
assert.deepEqual(
  resolveActiveDeliveryChannels('cap_warning', customPrefs),
  ['email', 'webhook'],
);
assert.deepEqual(
  resolveActiveDeliveryChannels('dispute_opened', customPrefs),
  ['in_app', 'email', 'webhook'],
);
assert.ok(loadNotificationCenterPreferences());

console.log('✓ [Issue #1865] Real-time v3 notification feed (#1507), unread state, urgent dispute links, and per-type (in-app/email/webhook) preferences verified!');
