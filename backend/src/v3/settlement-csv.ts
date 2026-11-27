import type { ProviderSettlement } from './types';

export const SETTLEMENT_CSV_HEADERS = [
  'date',
  'counterparty',
  'route',
  'quantity',
  'unit',
  'gross',
  'fee',
  'net',
  'asset',
  'settlement tx hash',
] as const;

export interface SettlementCsvRow {
  date: string;
  counterparty: string;
  route: string;
  quantity: number;
  unit: string;
  gross: number;
  fee: number;
  net: number;
  asset: string;
  settlementTxHash: string;
}

export interface SettlementCsvOptions {
  period: string;
  asset?: string;
  feeStroops?: (settlement: ProviderSettlement) => number;
  txHash?: (settlement: ProviderSettlement) => string;
}

export interface SettlementCsvExport {
  csv: string;
  totals: { gross: number; fee: number; net: number };
}

function sanitizeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\t\r-]/.test(text)) return `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function isInUtcMonth(isoDate: string, period: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new RangeError('period must use YYYY-MM format');
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 7) === period;
}

export function buildMonthlySettlementCsv(
  settlements: ProviderSettlement[],
  options: SettlementCsvOptions,
): SettlementCsvExport {
  const asset = options.asset ?? 'XLM';
  const feeStroops = options.feeStroops ?? (() => 0);
  const txHash = options.txHash ?? ((settlement) => settlement.receiptId);

  const rows: SettlementCsvRow[] = settlements
    .filter((settlement) => settlement.status === 'settled')
    .filter((settlement) => isInUtcMonth(settlement.meteredAt, options.period))
    .sort((a, b) => a.meteredAt.localeCompare(b.meteredAt))
    .map((settlement) => {
      const gross = settlement.amount;
      const fee = feeStroops(settlement);
      return {
        date: new Date(settlement.meteredAt).toISOString().slice(0, 10),
        counterparty: settlement.providerId,
        route: settlement.routeId,
        quantity: settlement.quantity,
        unit: settlement.unit,
        gross,
        fee,
        net: gross - fee,
        asset,
        settlementTxHash: txHash(settlement),
      };
    });

  const totals = rows.reduce(
    (sum, row) => ({ gross: sum.gross + row.gross, fee: sum.fee + row.fee, net: sum.net + row.net }),
    { gross: 0, fee: 0, net: 0 },
  );

  const csvRows = rows.map((row) => [
    row.date,
    row.counterparty,
    row.route,
    row.quantity,
    row.unit,
    row.gross,
    row.fee,
    row.net,
    row.asset,
    row.settlementTxHash,
  ].map(sanitizeCsvCell).join(','));

  return {
    csv: [SETTLEMENT_CSV_HEADERS.join(','), ...csvRows].join('\n'),
    totals,
  };
}
