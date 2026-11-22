import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  type AccountingExportRecord,
  buildStellarExplorerTxUrl,
  generateMonthlyStatement,
  generateStatementCSV,
  getSeededAccountingExport,
  renderStatementPrintableHTML,
} from '@/lib/statements/monthly-statements';
import { MonthlyStatementPanel } from '@/components/statements/MonthlyStatementPanel';

describe('Issue #1864: Downloadable monthly statements for principals and providers', () => {
  it('matches the settled totals for a seeded month exactly (principal spend per agent)', () => {
    const seeded = getSeededAccountingExport('2026-10', 'testnet');
    const statement = generateMonthlyStatement(seeded.principalRecords, {
      month: '2026-10',
      role: 'principal',
      network: 'testnet',
    });

    expect(statement.totalSettled).toBe(seeded.expectedPrincipalSettledTotal);
    expect(statement.totalSettledFormatted).toBe('112.50 USDC');
    expect(statement.settledLineCount).toBe(3);

    const byAgent = Object.fromEntries(
      statement.agentSummaries.map((a) => [a.agentId, a.settledTotal]),
    );
    expect(byAgent).toEqual(seeded.expectedSpendByAgent);

    const sumOfAgents = statement.agentSummaries.reduce((acc, a) => acc + a.settledTotal, 0);
    expect(sumOfAgents).toBe(statement.totalSettled);

    for (const line of statement.lines) {
      expect(line.explorerUrl).toBe(
        `https://stellar.expert/explorer/testnet/tx/${line.transactionHash}`,
      );
    }
  });

  it('matches the settled totals for a seeded month exactly (provider earnings per route)', () => {
    const seeded = getSeededAccountingExport('2026-10', 'testnet');
    const statement = generateMonthlyStatement(seeded.providerRecords, {
      month: '2026-10',
      role: 'provider',
      network: 'testnet',
    });

    expect(statement.totalSettled).toBe(seeded.expectedProviderSettledTotal);
    expect(statement.totalSettledFormatted).toBe('142.50 USDC');
    expect(statement.settledLineCount).toBe(3);

    const byRoute = Object.fromEntries(
      statement.routeSummaries.map((r) => [r.routeKey, r.settledTotal]),
    );
    expect(byRoute).toEqual(seeded.expectedEarningsByRoute);

    const sumOfRoutes = statement.routeSummaries.reduce((acc, r) => acc + r.settledTotal, 0);
    expect(sumOfRoutes).toBe(statement.totalSettled);

    for (const line of statement.lines) {
      expect(line.explorerUrl).toBe(
        `https://stellar.expert/explorer/testnet/tx/${line.transactionHash}`,
      );
    }
  });

  it('avoids floating-point drift using exact stroop arithmetic', () => {
    const records: AccountingExportRecord[] = [
      {
        settlementId: 's_1',
        settledAt: '2026-10-01T00:00:00.000Z',
        role: 'principal',
        accountId: 'p_1',
        agentId: 'a_1',
        agentName: 'Agent 1',
        routePath: '/v1/run',
        unit: 'calls',
        quantity: 1,
        unitPrice: 0.1,
        settledAmount: 0.1,
        asset: 'USDC',
        channelId: 'ch_1',
        transactionHash: 'tx_hash_01',
        status: 'settled',
      },
      {
        settlementId: 's_2',
        settledAt: '2026-10-02T00:00:00.000Z',
        role: 'principal',
        accountId: 'p_1',
        agentId: 'a_1',
        agentName: 'Agent 1',
        routePath: '/v1/run',
        unit: 'calls',
        quantity: 2,
        unitPrice: 0.1,
        settledAmount: 0.2,
        asset: 'USDC',
        channelId: 'ch_1',
        transactionHash: 'tx_hash_02',
        status: 'settled',
      },
    ];

    const statement = generateMonthlyStatement(records, {
      month: '2026-10',
      role: 'principal',
      network: 'mainnet',
    });

    expect(statement.totalSettled).toBe(0.3);
    expect(statement.totalSettledFormatted).toBe('0.30 USDC');
    expect(statement.lines[0]?.explorerUrl).toBe(
      buildStellarExplorerTxUrl('tx_hash_01', 'mainnet'),
    );
  });

  it('exports CSV and printable HTML views with Stellar explorer links on every line', () => {
    const seeded = getSeededAccountingExport('2026-10', 'testnet');
    const statement = generateMonthlyStatement(seeded.principalRecords, {
      month: '2026-10',
      role: 'principal',
      network: 'testnet',
    });

    const csv = generateStatementCSV(statement);
    expect(csv).toContain('StellarExplorerUrl');
    expect(csv).toContain('112.50');
    for (const line of statement.lines) {
      expect(csv).toContain(line.explorerUrl);
      expect(csv).toContain(line.transactionHash);
    }

    const html = renderStatementPrintableHTML(statement);
    expect(html).toContain('Principal Monthly Spend Statement — 2026-10');
    expect(html).toContain('112.50 USDC');
    expect(html).toContain('Demo Agent Alpha');
    expect(html).toContain('Research Indexer Agent');
    for (const line of statement.lines) {
      expect(html).toContain(`href="${line.explorerUrl}"`);
    }
  });

  it('renders MonthlyStatementPanel with CSV download and printable HTML/PDF view', () => {
    const onDownloadCSV = vi.fn();
    const onPrintHTML = vi.fn();

    render(
      <MonthlyStatementPanel
        role="principal"
        defaultMonth="2026-10"
        allowRoleSwitch
        onDownloadCSV={onDownloadCSV}
        onPrintHTML={onPrintHTML}
      />,
    );

    expect(screen.getByTestId('statement-settled-total')).toHaveTextContent('112.50 USDC');
    expect(screen.getAllByTestId('statement-line-row')).toHaveLength(3);

    const explorerLink = screen.getByTestId('statement-explorer-link-stl_p_001');
    expect(explorerLink).toHaveAttribute(
      'href',
      expect.stringContaining('https://stellar.expert/explorer/testnet/tx/'),
    );

    fireEvent.click(screen.getByTestId('download-statement-csv'));
    expect(onDownloadCSV).toHaveBeenCalledTimes(1);
    expect(onDownloadCSV.mock.calls[0]?.[0]).toContain('112.50');

    fireEvent.click(screen.getByTestId('toggle-printable-statement'));
    expect(onPrintHTML).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('statement-printable-view')).toBeInTheDocument();

    // Switch to provider role and verify exact settled earnings
    fireEvent.change(screen.getByLabelText('Statement role'), {
      target: { value: 'provider' },
    });
    expect(screen.getByTestId('statement-settled-total')).toHaveTextContent('142.50 USDC');
  });
});
