import type { Meta, StoryObj } from "@storybook/react";
import {
  Amount,
  StroopsAmount,
  Balance,
  CompactNumber,
  Nonce,
  Rate,
  Delta,
  MetricCard,
  MetricGrid,
} from "@syncro/ui";

const meta = {
  title: "Data/NumericDisplay",
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;

// Amount stories
export const AmountDefault: StoryObj = {
  render: () => (
    <div className="space-y-2">
      <Amount value={1_234_567} />
      <Amount value={1_234_567} asset={{ code: "XLM", symbol: "XLM", decimals: 7, baseUnit: 10_000_000 }} />
      <Amount value={0} blankZero />
      <Amount value={1_234_567} size="lg" weight="bold" />
      <Amount value={1_234_567} align="left" />
    </div>
  ),
};

export const AmountVariants: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Settlement (USDC)</p>
        <Amount value={1_234_567} label="Channel Balance" />
        <Amount value={987_654_321} label="Total Volume" />
        <Amount value={0} blankZero label="Empty Balance" />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">With XLM Asset</p>
        <Amount
          value={10_000_000}
          asset={{ code: "XLM", symbol: "XLM", decimals: 7, baseUnit: 10_000_000 }}
          label="1 XLM"
        />
        <Amount
          value={50_000_000}
          asset={{ code: "XLM", symbol: "XLM", decimals: 7, baseUnit: 10_000_000 }}
          label="5 XLM"
        />
      </div>
    </div>
  ),
};

// StroopsAmount stories
export const StroopsAmountDefault: StoryObj = {
  render: () => (
    <div className="space-y-2">
      <StroopsAmount value={10_000_000} />
      <StroopsAmount value={50_000_000} />
      <StroopsAmount value={0} blankZero />
      <StroopsAmount value={123_456_789} size="lg" weight="bold" />
    </div>
  ),
};

// Balance stories
export const BalanceDefault: StoryObj = {
  render: () => (
    <div className="space-y-2">
      <Balance value={1_234_567} />
      <Balance value={0} blankZero />
      <Balance value={987_654_321} asset={{ code: "XLM", symbol: "XLM", decimals: 7, baseUnit: 10_000_000 }} />
      <Balance value={1_234_567} size="xl" weight="bold" />
    </div>
  ),
};

// CompactNumber stories
export const CompactNumberDefault: StoryObj = {
  render: () => (
    <div className="space-y-2">
      <CompactNumber value={999} />
      <CompactNumber value={1_234} />
      <CompactNumber value={1_234_567} />
      <CompactNumber value={1_234_567_890} />
      <CompactNumber value={1_234_567_890_123} />
      <CompactNumber value={1_234_567} precision={2} />
    </div>
  ),
};

// Nonce stories
export const NonceDefault: StoryObj = {
  render: () => (
    <div className="space-y-2">
      <Nonce value={0} />
      <Nonce value={1} />
      <Nonce value={12345} />
      <Nonce value={999999999} />
      <Nonce value={12345} size="lg" weight="bold" />
    </div>
  ),
};

// Rate stories
export const RateDefault: StoryObj = {
  render: () => (
    <div className="space-y-2">
      <Rate value={123.4567} unit="calls/sec" />
      <Rate value={0.000045} unit="USDC/call" precision={6} />
      <Rate value={1000} unit="req/min" />
      <Rate value={42.5} unit="TPS" />
    </div>
  ),
};

// Delta stories
export const DeltaDefault: StoryObj = {
  render: () => (
    <div className="space-y-2">
      <Delta value={150} />
      <Delta value={-75} />
      <Delta value={0} />
      <Delta value={1234} asset={{ code: "USDC", symbol: "USDC", decimals: 6, baseUnit: 1_000_000 }} />
      <Delta value={5.2} asPercent showIcon />
      <Delta value={-3.1} asPercent showIcon variant="badge" />
      <Delta value={150} asset={{ code: "USDC", symbol: "USDC", decimals: 6, baseUnit: 1_000_000 }} showIcon variant="trend" />
    </div>
  ),
};

// MetricCard stories
export const MetricCardDefault: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl">
      <MetricCard
        label="Channel Balance"
        value={1_234_567}
        delta={5.2}
        deltaAsPercent
        sparklineData={[100, 120, 110, 140, 130, 150, 145, 160, 155, 170]}
        status="healthy"
      />
      <MetricCard
        label="Calls (24h)"
        value={45_670}
        delta={-2.1}
        deltaAsPercent
        sparklineData={[40000, 42000, 41000, 44000, 43000, 45000, 44500, 46000, 45500, 45670]}
        status="healthy"
      />
      <MetricCard
        label="Cost per Call"
        value={0.000045}
        delta={0.5}
        deltaAsPercent
        sparklineData={[0.000044, 0.000045, 0.000044, 0.000046, 0.000045, 0.000045, 0.000044, 0.000045, 0.000045, 0.000045]}
        status="degraded"
        formatValue={(v) => `$${v.toFixed(6)}`}
      />
      <MetricCard
        label="Error Rate"
        value={0.02}
        delta={-0.5}
        deltaAsPercent
        sparklineData={[0.03, 0.025, 0.028, 0.022, 0.024, 0.021, 0.023, 0.02, 0.019, 0.02]}
        status="failing"
        formatValue={(v) => `${(v * 100).toFixed(2)}%`}
      />
    </div>
  ),
};

export const MetricCardWithStatus: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl">
      <MetricCard
        label="Healthy Channel"
        value={1_234_567}
        delta={12.5}
        deltaAsPercent
        sparklineData={[100, 110, 105, 120, 115, 130, 125, 140, 135, 150]}
        status="healthy"
      />
      <MetricCard
        label="Degraded Channel"
        value={987_654}
        delta={-3.2}
        deltaAsPercent
        sparklineData={[1000, 980, 950, 920, 940, 910, 930, 900, 880, 870]}
        status="degraded"
      />
      <MetricCard
        label="Failing Channel"
        value={100_000}
        delta={-15.8}
        deltaAsPercent
        sparklineData={[500, 450, 400, 380, 350, 320, 300, 280, 250, 200]}
        status="failing"
      />
      <MetricCard
        label="Unknown Status"
        value={500_000}
        sparklineData={[100, 100, 100, 100, 100, 100, 100, 100, 100, 100]}
        status="unknown"
      />
    </div>
  ),
};

// MetricGrid stories
export const MetricGridDefault: StoryObj = {
  render: () => (
    <MetricGrid
      metrics={[
        { label: "Total Balance", value: 12_345_678, delta: 8.5, deltaAsPercent: true, status: "healthy", sparklineData: [10, 11, 10.5, 12, 11.5, 12.5, 12, 13, 12.5, 12.8] },
        { label: "Active Channels", value: 47, delta: 2, status: "healthy", sparklineData: [40, 41, 42, 43, 44, 45, 46, 47, 47, 47] },
        { label: "Calls (24h)", value: 1_234_567, delta: -1.2, deltaAsPercent: true, status: "degraded", sparklineData: [1.1, 1.15, 1.18, 1.2, 1.22, 1.24, 1.23, 1.24, 1.235, 1.234] },
        { label: "Avg Cost/Call", value: 0.000045, delta: 0.3, deltaAsPercent: true, status: "healthy", formatValue: (v) => `$${v.toFixed(6)}`, sparklineData: [0.000044, 0.000045, 0.000044, 0.000045, 0.000045, 0.000044, 0.000045, 0.000045, 0.000045, 0.000045] },
        { label: "Error Rate", value: 0.021, delta: -0.5, deltaAsPercent: true, status: "failing", formatValue: (v) => `${(v * 100).toFixed(2)}%`, sparklineData: [0.03, 0.028, 0.025, 0.024, 0.022, 0.021, 0.022, 0.021, 0.02, 0.021] },
        { label: "Revenue (24h)", value: 55_555, delta: 15.3, deltaAsPercent: true, status: "healthy", sparklineData: [40000, 45000, 48000, 50000, 52000, 53000, 54000, 54500, 55000, 55555] },
      ]}
      columns={{ base: 1, sm: 2, md: 3, lg: 4, xl: 6 }}
    />
  ),
};