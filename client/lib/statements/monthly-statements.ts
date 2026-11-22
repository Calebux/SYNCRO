import { generateSafeCSV } from '../csv-utils';
import type { ProviderSettlement } from '../provider-console';

export type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet';
export type StatementRole = 'principal' | 'provider';

const EXPLORER_BASE_URLS: Record<StellarNetwork, string> = {
  testnet: 'https://stellar.expert/explorer/testnet',
  mainnet: 'https://stellar.expert/explorer/public',
  futurenet: 'https://stellar.expert/explorer/futurenet',
};

const STROOPS_SCALE = 10_000_000n;
const STROOPS_NUMBER = 10_000_000;

export function buildStellarExplorerTxUrl(
  transactionHash: string,
  network: StellarNetwork = 'testnet',
): string {
  const cleanHash = transactionHash.trim();
  const base = EXPLORER_BASE_URLS[network] ?? EXPLORER_BASE_URLS.testnet;
  return `${base}/tx/${encodeURIComponent(cleanHash)}`;
}

function toStroops(amount: number): bigint {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`Invalid settlement amount: ${amount}`);
  }
  return BigInt(Math.round(amount * STROOPS_NUMBER));
}

function fromStroops(stroops: bigint): number {
  return Number(stroops) / STROOPS_NUMBER;
}

export function formatStatementAmount(amount: number, asset: string = 'USDC'): string {
  const exact = fromStroops(toStroops(amount));
  const formatted = Number.isInteger(exact * 100)
    ? exact.toFixed(2)
    : exact.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
  return `${formatted} ${asset}`;
}

export interface AccountingExportRecord {
  settlementId: string;
  settledAt: string;
  role: StatementRole;
  accountId: string;
  accountName?: string;
  agentId?: string;
  agentName?: string;
  providerId?: string;
  routeId?: string;
  method?: string;
  routePath: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  settledAmount: number;
  asset: string;
  channelId: string;
  transactionHash: string;
  network?: StellarNetwork;
  status?: 'settled' | 'unsettled' | 'in_dispute';
  rateCardVersion?: string;
}

export interface StatementSettlementReference {
  settlementId: string;
  transactionHash: string;
  explorerUrl: string;
}

export interface StatementLineItem {
  lineNumber: number;
  settlementId: string;
  settledAt: string;
  agentId?: string;
  agentName?: string;
  routeId?: string;
  method: string;
  routePath: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  settledAmount: number;
  settledAmountFormatted: string;
  asset: string;
  channelId: string;
  transactionHash: string;
  explorerUrl: string;
  rateCardVersion?: string;
}

export interface PrincipalAgentSummary {
  agentId: string;
  agentName: string;
  callCount: number;
  totalUnits: number;
  settledTotal: number;
  settledTotalFormatted: string;
  asset: string;
  settlementReferences: StatementSettlementReference[];
}

export interface ProviderRouteSummary {
  routeKey: string;
  routeId: string;
  method: string;
  routePath: string;
  unit: string;
  callCount: number;
  totalQuantity: number;
  settledTotal: number;
  settledTotalFormatted: string;
  asset: string;
  settlementReferences: StatementSettlementReference[];
}

export interface MonthlyStatement {
  statementId: string;
  month: string;
  role: StatementRole;
  accountId: string;
  accountName: string;
  asset: string;
  network: StellarNetwork;
  generatedAt: string;
  totalSettled: number;
  totalSettledFormatted: string;
  settledLineCount: number;
  agentSummaries: PrincipalAgentSummary[];
  routeSummaries: ProviderRouteSummary[];
  lines: StatementLineItem[];
}

export interface GenerateMonthlyStatementOptions {
  month: string;
  role: StatementRole;
  accountId?: string;
  accountName?: string;
  asset?: string;
  network?: StellarNetwork;
  generatedAt?: string;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function generateMonthlyStatement(
  records: AccountingExportRecord[],
  options: GenerateMonthlyStatementOptions,
): MonthlyStatement {
  if (!MONTH_PATTERN.test(options.month)) {
    throw new Error(`Invalid statement month "${options.month}". Expected YYYY-MM.`);
  }

  const network: StellarNetwork = options.network ?? 'testnet';
  const asset = options.asset ?? records[0]?.asset ?? 'USDC';
  const accountId =
    options.accountId ??
    records.find((r) => r.role === options.role)?.accountId ??
    (options.role === 'principal' ? 'principal-demo' : 'v3-provider-demo');
  const accountName =
    options.accountName ??
    records.find((r) => r.role === options.role)?.accountName ??
    (options.role === 'principal' ? 'Demo Principal' : 'v3 mock provider');

  const filtered = records
    .filter((record) => {
      if (record.role !== options.role) return false;
      if (options.accountId && record.accountId !== options.accountId) return false;
      const status = record.status ?? 'settled';
      if (status !== 'settled') return false;
      return record.settledAt.slice(0, 7) === options.month;
    })
    .sort((a, b) => a.settledAt.localeCompare(b.settledAt) || a.settlementId.localeCompare(b.settlementId));

  let totalStroops = 0n;

  const lines: StatementLineItem[] = filtered.map((record, index) => {
    const lineNetwork = record.network ?? network;
    const itemStroops = toStroops(record.settledAmount);
    totalStroops += itemStroops;
    const exactAmount = fromStroops(itemStroops);
    const explorerUrl = buildStellarExplorerTxUrl(record.transactionHash, lineNetwork);

    return {
      lineNumber: index + 1,
      settlementId: record.settlementId,
      settledAt: record.settledAt,
      ...(record.agentId ? { agentId: record.agentId } : {}),
      ...(record.agentName ? { agentName: record.agentName } : {}),
      ...(record.routeId ? { routeId: record.routeId } : {}),
      method: (record.method ?? 'POST').toUpperCase(),
      routePath: record.routePath,
      unit: record.unit,
      quantity: record.quantity,
      unitPrice: record.unitPrice,
      settledAmount: exactAmount,
      settledAmountFormatted: formatStatementAmount(exactAmount, record.asset || asset),
      asset: record.asset || asset,
      channelId: record.channelId,
      transactionHash: record.transactionHash,
      explorerUrl,
      ...(record.rateCardVersion ? { rateCardVersion: record.rateCardVersion } : {}),
    };
  });

  const agentSummaries: PrincipalAgentSummary[] = [];
  const routeSummaries: ProviderRouteSummary[] = [];

  if (options.role === 'principal') {
    const byAgent = new Map<
      string,
      {
        agentId: string;
        agentName: string;
        callCount: number;
        totalUnits: number;
        stroops: bigint;
        refs: StatementSettlementReference[];
      }
    >();

    for (const line of lines) {
      const agentId = line.agentId ?? 'unassigned-agent';
      const agentName = line.agentName ?? agentId;
      const existing = byAgent.get(agentId) ?? {
        agentId,
        agentName,
        callCount: 0,
        totalUnits: 0,
        stroops: 0n,
        refs: [],
      };
      existing.callCount += 1;
      existing.totalUnits += line.quantity;
      existing.stroops += toStroops(line.settledAmount);
      existing.refs.push({
        settlementId: line.settlementId,
        transactionHash: line.transactionHash,
        explorerUrl: line.explorerUrl,
      });
      byAgent.set(agentId, existing);
    }

    for (const entry of byAgent.values()) {
      const settledTotal = fromStroops(entry.stroops);
      agentSummaries.push({
        agentId: entry.agentId,
        agentName: entry.agentName,
        callCount: entry.callCount,
        totalUnits: entry.totalUnits,
        settledTotal,
        settledTotalFormatted: formatStatementAmount(settledTotal, asset),
        asset,
        settlementReferences: entry.refs,
      });
    }
  } else {
    const byRoute = new Map<
      string,
      {
        routeKey: string;
        routeId: string;
        method: string;
        routePath: string;
        unit: string;
        callCount: number;
        totalQuantity: number;
        stroops: bigint;
        refs: StatementSettlementReference[];
      }
    >();

    for (const line of lines) {
      const routeId = line.routeId ?? `${line.method}:${line.routePath}`;
      const routeKey = `${line.method} ${line.routePath}`;
      const existing = byRoute.get(routeKey) ?? {
        routeKey,
        routeId,
        method: line.method,
        routePath: line.routePath,
        unit: line.unit,
        callCount: 0,
        totalQuantity: 0,
        stroops: 0n,
        refs: [],
      };
      existing.callCount += 1;
      existing.totalQuantity += line.quantity;
      existing.stroops += toStroops(line.settledAmount);
      existing.refs.push({
        settlementId: line.settlementId,
        transactionHash: line.transactionHash,
        explorerUrl: line.explorerUrl,
      });
      byRoute.set(routeKey, existing);
    }

    for (const entry of byRoute.values()) {
      const settledTotal = fromStroops(entry.stroops);
      routeSummaries.push({
        routeKey: entry.routeKey,
        routeId: entry.routeId,
        method: entry.method,
        routePath: entry.routePath,
        unit: entry.unit,
        callCount: entry.callCount,
        totalQuantity: entry.totalQuantity,
        settledTotal,
        settledTotalFormatted: formatStatementAmount(settledTotal, asset),
        asset,
        settlementReferences: entry.refs,
      });
    }
  }

  const totalSettled = fromStroops(totalStroops);

  return {
    statementId: `stmt_${options.role}_${accountId}_${options.month}`,
    month: options.month,
    role: options.role,
    accountId,
    accountName,
    asset,
    network,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    totalSettled,
    totalSettledFormatted: formatStatementAmount(totalSettled, asset),
    settledLineCount: lines.length,
    agentSummaries,
    routeSummaries,
    lines,
  };
}

export function generateStatementCSV(statement: MonthlyStatement): string {
  const headers = [
    'Line',
    'Month',
    'Role',
    'AccountId',
    statement.role === 'principal' ? 'AgentId' : 'RouteId',
    statement.role === 'principal' ? 'AgentName' : 'RouteKey',
    'Method',
    'RoutePath',
    'Unit',
    'Quantity',
    'UnitPrice',
    'SettledAmount',
    'Asset',
    'SettlementId',
    'ChannelId',
    'TransactionHash',
    'StellarExplorerUrl',
  ];

  const rows: unknown[][] = statement.lines.map((line) => [
    line.lineNumber,
    statement.month,
    statement.role,
    statement.accountId,
    statement.role === 'principal' ? (line.agentId ?? '') : (line.routeId ?? `${line.method}:${line.routePath}`),
    statement.role === 'principal' ? (line.agentName ?? '') : `${line.method} ${line.routePath}`,
    line.method,
    line.routePath,
    line.unit,
    line.quantity,
    line.unitPrice,
    line.settledAmount.toFixed(2),
    line.asset,
    line.settlementId,
    line.channelId,
    line.transactionHash,
    line.explorerUrl,
  ]);

  rows.push([
    'TOTAL',
    statement.month,
    statement.role,
    statement.accountId,
    '',
    statement.role === 'principal' ? 'Total Settled Spend' : 'Total Settled Earnings',
    '',
    '',
    '',
    '',
    '',
    statement.totalSettled.toFixed(2),
    statement.asset,
    `LINES:${statement.settledLineCount}`,
    '',
    '',
    '',
  ]);

  return generateSafeCSV(headers, rows);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderStatementPrintableHTML(statement: MonthlyStatement): string {
  const title =
    statement.role === 'principal'
      ? `Principal Monthly Spend Statement — ${statement.month}`
      : `Provider Monthly Earnings Statement — ${statement.month}`;

  const summaryHeading =
    statement.role === 'principal' ? 'Spend per Agent' : 'Earnings per Route';

  const summaryRowsHtml =
    statement.role === 'principal'
      ? statement.agentSummaries
          .map(
            (agent) => `
          <tr>
            <td>${escapeHtml(agent.agentName)} (<code>${escapeHtml(agent.agentId)}</code>)</td>
            <td>${agent.callCount}</td>
            <td>${agent.totalUnits}</td>
            <td class="num">${escapeHtml(agent.settledTotalFormatted)}</td>
            <td>${agent.settlementReferences
              .map(
                (ref) =>
                  `<a href="${escapeHtml(ref.explorerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ref.settlementId)} (${escapeHtml(ref.transactionHash.slice(0, 12))}…)</a>`,
              )
              .join(', ')}</td>
          </tr>`,
          )
          .join('')
      : statement.routeSummaries
          .map(
            (route) => `
          <tr>
            <td><code>${escapeHtml(route.routeKey)}</code> (${escapeHtml(route.unit)})</td>
            <td>${route.callCount}</td>
            <td>${route.totalQuantity}</td>
            <td class="num">${escapeHtml(route.settledTotalFormatted)}</td>
            <td>${route.settlementReferences
              .map(
                (ref) =>
                  `<a href="${escapeHtml(ref.explorerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ref.settlementId)} (${escapeHtml(ref.transactionHash.slice(0, 12))}…)</a>`,
              )
              .join(', ')}</td>
          </tr>`,
          )
          .join('');

  const lineRowsHtml = statement.lines
    .map(
      (line) => `
      <tr>
        <td>${line.lineNumber}</td>
        <td>${escapeHtml(line.settledAt)}</td>
        <td>${escapeHtml(
          statement.role === 'principal'
            ? `${line.agentName ?? line.agentId ?? '—'}`
            : `${line.method} ${line.routePath}`,
        )}</td>
        <td><code>${escapeHtml(`${line.method} ${line.routePath}`)}</code></td>
        <td>${line.quantity} ${escapeHtml(line.unit)}</td>
        <td class="num">${escapeHtml(line.settledAmountFormatted)}</td>
        <td><code>${escapeHtml(line.settlementId)}</code> / <code>${escapeHtml(line.channelId)}</code></td>
        <td><a href="${escapeHtml(line.explorerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(line.transactionHash)}</a></td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111827; margin: 32px; }
    header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 24px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    h2 { font-size: 16px; margin: 24px 0 10px; }
    .meta { font-size: 13px; color: #4b5563; line-height: 1.5; }
    .total-box { text-align: right; background: #f3f4f6; padding: 12px 16px; border-radius: 8px; }
    .total-label { font-size: 12px; text-transform: uppercase; color: #4b5563; }
    .total-value { font-size: 20px; font-weight: 700; font-family: ui-monospace, monospace; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    td.num, th.num { text-align: right; font-family: ui-monospace, monospace; }
    tfoot td { font-weight: 700; border-top: 2px solid #111827; }
    a { color: #047857; text-decoration: underline; }
    @media print {
      body { margin: 12mm; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        <div>Statement ID: <code>${escapeHtml(statement.statementId)}</code></div>
        <div>Account: ${escapeHtml(statement.accountName)} (<code>${escapeHtml(statement.accountId)}</code>)</div>
        <div>Stellar Network: ${escapeHtml(statement.network)}</div>
      </div>
    </div>
    <div class="total-box">
      <div class="total-label">Total Settled (${escapeHtml(statement.month)})</div>
      <div class="total-value">${escapeHtml(statement.totalSettledFormatted)}</div>
      <div class="meta">${statement.settledLineCount} settled transaction(s)</div>
    </div>
  </header>

  <section>
    <h2>${escapeHtml(summaryHeading)}</h2>
    <table>
      <thead>
        <tr>
          <th>${statement.role === 'principal' ? 'Agent' : 'Route'}</th>
          <th>Settled Calls</th>
          <th>Total Units</th>
          <th class="num">Settled Total</th>
          <th>Settlement References</th>
        </tr>
      </thead>
      <tbody>
        ${summaryRowsHtml}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Settlement Line Items</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Settled At</th>
          <th>${statement.role === 'principal' ? 'Agent' : 'Route'}</th>
          <th>Endpoint</th>
          <th>Quantity</th>
          <th class="num">Settled Amount</th>
          <th>Settlement / Channel</th>
          <th>Stellar Explorer Transaction</th>
        </tr>
      </thead>
      <tbody>
        ${lineRowsHtml}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="5">Settled Statement Total</td>
          <td class="num">${escapeHtml(statement.totalSettledFormatted)}</td>
          <td colspan="2">${statement.settledLineCount} settled line(s)</td>
        </tr>
      </tfoot>
    </table>
  </section>
</body>
</html>`;
}

export function accountingRecordsFromProviderSettlements(
  providerId: string,
  providerIdentity: string,
  settlements: ProviderSettlement[],
  network: StellarNetwork = 'testnet',
): AccountingExportRecord[] {
  return settlements.map((settlement) => ({
    settlementId: settlement.settlementId,
    settledAt: settlement.meteredAt,
    role: 'provider',
    accountId: providerId,
    accountName: providerIdentity,
    providerId,
    routeId: settlement.routeId,
    method: settlement.method,
    routePath: settlement.pathPattern,
    unit: settlement.unit,
    quantity: settlement.quantity,
    unitPrice: settlement.price,
    settledAmount: settlement.amount,
    asset: 'USDC',
    channelId: settlement.channelId,
    transactionHash: `tx_${settlement.settlementId}_${settlement.receiptId}`.replace(/[^a-zA-Z0-9_]/g, ''),
    network,
    status: settlement.status,
    rateCardVersion: settlement.rateCardVersion,
  }));
}

export interface SeededMonthAccountingBundle {
  month: string;
  network: StellarNetwork;
  principalRecords: AccountingExportRecord[];
  providerRecords: AccountingExportRecord[];
  expectedPrincipalSettledTotal: number;
  expectedProviderSettledTotal: number;
  expectedSpendByAgent: Record<string, number>;
  expectedEarningsByRoute: Record<string, number>;
}

/**
 * Deterministic accounting export for a seeded month (aligns with `backend/scripts/seed-v3.mjs`
 * identifiers `v3-agent-demo`, `v3-provider-demo`, `v3-ch-demo`).
 *
 * Includes settled lines across multiple agents and routes, plus unsettled/in-dispute rows
 * (and an out-of-month row) to verify that the generated monthly statement matches
 * the settled totals for the seeded month *exactly*.
 */
export function getSeededAccountingExport(
  month: string = '2026-10',
  network: StellarNetwork = 'testnet',
): SeededMonthAccountingBundle {
  const principalRecords: AccountingExportRecord[] = [
    {
      settlementId: 'stl_p_001',
      settledAt: `${month}-04T10:15:00.000Z`,
      role: 'principal',
      accountId: 'v3-principal-demo',
      accountName: 'v3-dev@local.dev',
      agentId: 'v3-agent-demo',
      agentName: 'Demo Agent Alpha',
      providerId: 'v3-provider-demo',
      method: 'POST',
      routePath: '/api/v3/gateway/proxy',
      unit: 'calls',
      quantity: 120,
      unitPrice: 0.25,
      settledAmount: 30.0,
      asset: 'USDC',
      channelId: 'v3-ch-demo',
      transactionHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff01',
      network,
      status: 'settled',
    },
    {
      settlementId: 'stl_p_002',
      settledAt: `${month}-12T14:30:00.000Z`,
      role: 'principal',
      accountId: 'v3-principal-demo',
      accountName: 'v3-dev@local.dev',
      agentId: 'v3-agent-demo',
      agentName: 'Demo Agent Alpha',
      providerId: 'v3-provider-demo',
      method: 'POST',
      routePath: '/api/v3/gateway/inference',
      unit: 'tokens',
      quantity: 450,
      unitPrice: 0.1,
      settledAmount: 45.0,
      asset: 'USDC',
      channelId: 'v3-ch-demo',
      transactionHash: 'b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0002',
      network,
      status: 'settled',
    },
    {
      settlementId: 'stl_p_003',
      settledAt: `${month}-19T09:05:00.000Z`,
      role: 'principal',
      accountId: 'v3-principal-demo',
      accountName: 'v3-dev@local.dev',
      agentId: 'v3-agent-research',
      agentName: 'Research Indexer Agent',
      providerId: 'v3-provider-demo',
      method: 'POST',
      routePath: '/api/v3/gateway/compute',
      unit: 'seconds',
      quantity: 75,
      unitPrice: 0.5,
      settledAmount: 37.5,
      asset: 'USDC',
      channelId: 'v3-ch-research',
      transactionHash: 'c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff000003',
      network,
      status: 'settled',
    },
    {
      // Unsettled row in the same month — must NOT be counted in settled totals
      settlementId: 'stl_p_004_unsettled',
      settledAt: `${month}-25T16:00:00.000Z`,
      role: 'principal',
      accountId: 'v3-principal-demo',
      accountName: 'v3-dev@local.dev',
      agentId: 'v3-agent-demo',
      agentName: 'Demo Agent Alpha',
      providerId: 'v3-provider-demo',
      method: 'POST',
      routePath: '/api/v3/gateway/proxy',
      unit: 'calls',
      quantity: 40,
      unitPrice: 0.25,
      settledAmount: 10.0,
      asset: 'USDC',
      channelId: 'v3-ch-demo',
      transactionHash: 'd4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00000004',
      network,
      status: 'unsettled',
    },
    {
      // Settled row from a different month — must NOT be counted in target month
      settlementId: 'stl_p_005_prev_month',
      settledAt: '2026-09-28T11:00:00.000Z',
      role: 'principal',
      accountId: 'v3-principal-demo',
      accountName: 'v3-dev@local.dev',
      agentId: 'v3-agent-demo',
      agentName: 'Demo Agent Alpha',
      providerId: 'v3-provider-demo',
      method: 'POST',
      routePath: '/api/v3/gateway/proxy',
      unit: 'calls',
      quantity: 80,
      unitPrice: 0.25,
      settledAmount: 20.0,
      asset: 'USDC',
      channelId: 'v3-ch-demo',
      transactionHash: 'e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0000000005',
      network,
      status: 'settled',
    },
  ];

  const providerRecords: AccountingExportRecord[] = [
    {
      settlementId: 'stl_prov_001',
      settledAt: `${month}-05T11:00:00.000Z`,
      role: 'provider',
      accountId: 'v3-provider-demo',
      accountName: 'v3 mock provider',
      providerId: 'v3-provider-demo',
      routeId: 'route_echo',
      method: 'POST',
      routePath: '/mock/echo',
      unit: 'request',
      quantity: 200,
      unitPrice: 0.15,
      settledAmount: 30.0,
      asset: 'USDC',
      channelId: 'v3-ch-demo',
      transactionHash: 'f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff11',
      network,
      status: 'settled',
      rateCardVersion: 'v1',
    },
    {
      settlementId: 'stl_prov_002',
      settledAt: `${month}-14T15:20:00.000Z`,
      role: 'provider',
      accountId: 'v3-provider-demo',
      accountName: 'v3 mock provider',
      providerId: 'v3-provider-demo',
      routeId: 'route_echo',
      method: 'POST',
      routePath: '/mock/echo',
      unit: 'request',
      quantity: 150,
      unitPrice: 0.2,
      settledAmount: 30.0,
      asset: 'USDC',
      channelId: 'v3-ch-demo',
      transactionHash: 'f2e3d4c5b6a798897a6b5c4d3e2f1000112233445566778899aabbccddeeff22',
      network,
      status: 'settled',
      rateCardVersion: 'v2',
    },
    {
      settlementId: 'stl_prov_003',
      settledAt: `${month}-21T18:45:00.000Z`,
      role: 'provider',
      accountId: 'v3-provider-demo',
      accountName: 'v3 mock provider',
      providerId: 'v3-provider-demo',
      routeId: 'route_embed',
      method: 'POST',
      routePath: '/v1/embeddings',
      unit: 'tokens',
      quantity: 825,
      unitPrice: 0.1,
      settledAmount: 82.5,
      asset: 'USDC',
      channelId: 'v3-ch-research',
      transactionHash: 'f3e4d5c6b7a8998a7b6c5d4e3f210000112233445566778899aabbccddeeff33',
      network,
      status: 'settled',
      rateCardVersion: 'v1',
    },
    {
      // Disputed row — must NOT be included in settled totals
      settlementId: 'stl_prov_004_dispute',
      settledAt: `${month}-23T08:00:00.000Z`,
      role: 'provider',
      accountId: 'v3-provider-demo',
      accountName: 'v3 mock provider',
      providerId: 'v3-provider-demo',
      routeId: 'route_embed',
      method: 'POST',
      routePath: '/v1/embeddings',
      unit: 'tokens',
      quantity: 100,
      unitPrice: 0.1,
      settledAmount: 10.0,
      asset: 'USDC',
      channelId: 'v3-ch-research',
      transactionHash: 'f4e5d6c7b8a99a8b7c6d5e4f32100000112233445566778899aabbccddeeff44',
      network,
      status: 'in_dispute',
      rateCardVersion: 'v1',
    },
  ];

  return {
    month,
    network,
    principalRecords,
    providerRecords,
    expectedPrincipalSettledTotal: 112.5, // 30.00 + 45.00 + 37.50
    expectedProviderSettledTotal: 142.5, // 30.00 + 30.00 + 82.50
    expectedSpendByAgent: {
      'v3-agent-demo': 75.0,
      'v3-agent-research': 37.5,
    },
    expectedEarningsByRoute: {
      'POST /mock/echo': 60.0,
      'POST /v1/embeddings': 82.5,
    },
  };
}
