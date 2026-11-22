'use client';

import { useMemo, useState } from 'react';
import {
  type AccountingExportRecord,
  type MonthlyStatement,
  type StatementRole,
  type StellarNetwork,
  generateMonthlyStatement,
  generateStatementCSV,
  getSeededAccountingExport,
  renderStatementPrintableHTML,
} from '@/lib/statements/monthly-statements';

export interface MonthlyStatementPanelProps {
  role: StatementRole;
  defaultMonth?: string;
  accountId?: string;
  accountName?: string;
  network?: StellarNetwork;
  records?: AccountingExportRecord[];
  allowRoleSwitch?: boolean;
  onDownloadCSV?: (csv: string, statement: MonthlyStatement) => void;
  onPrintHTML?: (html: string, statement: MonthlyStatement) => void;
}

export function MonthlyStatementPanel({
  role: initialRole,
  defaultMonth = '2026-10',
  accountId,
  accountName,
  network = 'testnet',
  records,
  allowRoleSwitch = false,
  onDownloadCSV,
  onPrintHTML,
}: MonthlyStatementPanelProps) {
  const [activeRole, setActiveRole] = useState<StatementRole>(initialRole);
  const [month, setMonth] = useState<string>(defaultMonth);
  const [showPrintableView, setShowPrintableView] = useState<boolean>(false);
  const [lastDownloaded, setLastDownloaded] = useState<string | null>(null);

  const effectiveRecords = useMemo(() => {
    if (records && records.length > 0) {
      return records;
    }
    const seeded = getSeededAccountingExport(month, network);
    return activeRole === 'principal' ? seeded.principalRecords : seeded.providerRecords;
  }, [records, month, network, activeRole]);

  const statement = useMemo(
    () =>
      generateMonthlyStatement(effectiveRecords, {
        month,
        role: activeRole,
        accountId,
        accountName,
        network,
      }),
    [effectiveRecords, month, activeRole, accountId, accountName, network],
  );

  const csvContent = useMemo(() => generateStatementCSV(statement), [statement]);
  const printableHtml = useMemo(() => renderStatementPrintableHTML(statement), [statement]);

  function handleDownloadCSV() {
    if (onDownloadCSV) {
      onDownloadCSV(csvContent, statement);
    } else if (typeof window !== 'undefined' && typeof Blob !== 'undefined') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `syncro-${statement.role}-statement-${statement.month}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }
    setLastDownloaded(`CSV downloaded (${statement.month})`);
  }

  function handleOpenPrintableView() {
    setShowPrintableView((prev) => !prev);
    if (onPrintHTML) {
      onPrintHTML(printableHtml, statement);
    }
  }

  return (
    <section
      aria-labelledby="monthly-statement-heading"
      data-testid="monthly-statement-panel"
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="monthly-statement-heading" className="text-lg font-semibold text-gray-900">
            Monthly statements
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {activeRole === 'principal'
              ? 'Finance statement of settled spend per agent with on-chain Stellar settlement references.'
              : 'Finance statement of settled earnings per route with on-chain Stellar settlement references.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {allowRoleSwitch && (
            <label className="text-xs font-medium text-gray-700">
              View as{' '}
              <select
                aria-label="Statement role"
                value={activeRole}
                onChange={(e) => setActiveRole(e.target.value as StatementRole)}
                className="ml-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="principal">Principal (Spend per agent)</option>
                <option value="provider">Provider (Earnings per route)</option>
              </select>
            </label>
          )}

          <label className="text-xs font-medium text-gray-700">
            Statement month{' '}
            <input
              aria-label="Statement month"
              type="month"
              value={month}
              onChange={(e) => {
                if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) {
                  setMonth(e.target.value);
                }
              }}
              className="ml-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={handleDownloadCSV}
            data-testid="download-statement-csv"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Download CSV
          </button>

          <button
            type="button"
            onClick={handleOpenPrintableView}
            data-testid="toggle-printable-statement"
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            {showPrintableView ? 'Hide printable PDF/HTML view' : 'Printable PDF / HTML view'}
          </button>
        </div>
      </div>

      {lastDownloaded && (
        <p role="status" data-testid="statement-download-status" className="text-xs font-medium text-emerald-700">
          {lastDownloaded}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {activeRole === 'principal' ? 'Settled spend for month' : 'Settled earnings for month'}
          </p>
          <p data-testid="statement-settled-total" className="mt-1 font-mono text-xl font-semibold text-gray-900">
            {statement.totalSettledFormatted}
          </p>
        </div>
        <div className="text-right text-xs text-gray-600">
          <div>Statement ID: <span className="font-mono">{statement.statementId}</span></div>
          <div>{statement.settledLineCount} settled transaction line(s) · Stellar {statement.network}</div>
        </div>
      </div>

      {activeRole === 'principal' ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Spend per agent ({statement.month})
          </h3>
          {statement.agentSummaries.length === 0 ? (
            <p className="text-sm text-gray-500">No settled agent spend recorded for {statement.month}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="statement-agent-summary-table">
                <thead>
                  <tr className="border-b text-xs uppercase text-gray-500">
                    <th className="py-2 pr-3">Agent</th>
                    <th className="py-2 pr-3">Settled Calls</th>
                    <th className="py-2 pr-3">Units</th>
                    <th className="py-2 pr-3 text-right">Settled Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.agentSummaries.map((agent) => (
                    <tr key={agent.agentId} className="border-b last:border-0" data-testid={`statement-agent-${agent.agentId}`}>
                      <td className="py-2.5 pr-3 font-medium">
                        {agent.agentName} <span className="font-mono text-xs text-gray-500">({agent.agentId})</span>
                      </td>
                      <td className="py-2.5 pr-3">{agent.callCount}</td>
                      <td className="py-2.5 pr-3">{agent.totalUnits}</td>
                      <td className="py-2.5 pr-3 text-right font-mono font-medium">{agent.settledTotalFormatted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Earnings per route ({statement.month})
          </h3>
          {statement.routeSummaries.length === 0 ? (
            <p className="text-sm text-gray-500">No settled route earnings recorded for {statement.month}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="statement-route-summary-table">
                <thead>
                  <tr className="border-b text-xs uppercase text-gray-500">
                    <th className="py-2 pr-3">Route</th>
                    <th className="py-2 pr-3">Unit</th>
                    <th className="py-2 pr-3">Settled Calls</th>
                    <th className="py-2 pr-3">Quantity</th>
                    <th className="py-2 pr-3 text-right">Settled Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.routeSummaries.map((route) => (
                    <tr key={route.routeKey} className="border-b last:border-0" data-testid={`statement-route-${route.routeKey}`}>
                      <td className="py-2.5 pr-3 font-mono text-xs font-medium">{route.routeKey}</td>
                      <td className="py-2.5 pr-3">{route.unit}</td>
                      <td className="py-2.5 pr-3">{route.callCount}</td>
                      <td className="py-2.5 pr-3">{route.totalQuantity}</td>
                      <td className="py-2.5 pr-3 text-right font-mono font-medium">{route.settledTotalFormatted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Statement lines &amp; Stellar settlement references
        </h3>
        {statement.lines.length === 0 ? (
          <p className="text-sm text-gray-500">No settled statement lines in {statement.month}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="statement-lines-table">
              <thead>
                <tr className="border-b text-xs uppercase text-gray-500">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Settled At</th>
                  <th className="py-2 pr-3">{activeRole === 'principal' ? 'Agent' : 'Route'}</th>
                  <th className="py-2 pr-3">Quantity</th>
                  <th className="py-2 pr-3 text-right">Settled Amount</th>
                  <th className="py-2">Stellar Explorer Settlement</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((line) => (
                  <tr key={line.settlementId} className="border-b last:border-0" data-testid="statement-line-row">
                    <td className="py-2.5 pr-3 font-mono text-xs">{line.lineNumber}</td>
                    <td className="py-2.5 pr-3 text-xs text-gray-600">{line.settledAt.slice(0, 10)}</td>
                    <td className="py-2.5 pr-3">
                      {activeRole === 'principal' ? (
                        <span>{line.agentName ?? line.agentId}</span>
                      ) : (
                        <span className="font-mono text-xs">{line.method} {line.routePath}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">{line.quantity} {line.unit}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">{line.settledAmountFormatted}</td>
                    <td className="py-2.5">
                      <a
                        href={line.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`statement-explorer-link-${line.settlementId}`}
                        className="font-mono text-xs text-emerald-700 underline hover:text-emerald-900"
                      >
                        {line.transactionHash.slice(0, 16)}…
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPrintableView && (
        <div
          data-testid="statement-printable-view"
          className="rounded-xl border border-gray-300 bg-gray-50 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Printable HTML / PDF Statement Preview ({statement.month})
            </p>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && typeof window.print === 'function') {
                  window.print();
                }
              }}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800"
            >
              Print / Save as PDF
            </button>
          </div>
          <div
            data-testid="statement-printable-html-content"
            className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-white p-4 text-xs"
            dangerouslySetInnerHTML={{ __html: printableHtml }}
          />
        </div>
      )}
    </section>
  );
}
