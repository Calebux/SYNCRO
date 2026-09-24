import type { Meta, StoryObj } from "@storybook/react";
import { Sparkline, SparklineWithValue, DeltaIndicator } from "@syncro/ui";

const meta = {
  title: "Data/Sparkline",
  component: Sparkline,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["line", "area", "bar"] },
    tone: { control: "select", options: ["positive", "negative", "neutral", "info"] },
    size: { control: "select", options: ["sm", "md", "lg", "xl"] },
    showLastPoint: { control: "boolean" },
    animationDuration: { control: "number" },
  },
} satisfies Meta<typeof Sparkline>;

export default meta;
type Story = StoryObj<typeof meta>;

// Generate sample data
const generateData = (count: number, trend: "up" | "down" | "flat" | "volatile" = "volatile") => {
  let base = 100;
  return Array.from({ length: count }, () => {
    let change = 0;
    switch (trend) {
      case "up":
        change = Math.random() * 3 - 0.5;
        break;
      case "down":
        change = Math.random() * -3 + 0.5;
        break;
      case "flat":
        change = (Math.random() - 0.5) * 2;
        break;
      case "volatile":
        change = (Math.random() - 0.5) * 10;
        break;
    }
    base = Math.max(0, base + change);
    return base;
  });
};

const upData = generateData(20, "up");
const downData = generateData(20, "down");
const flatData = generateData(20, "flat");
const volatileData = generateData(20, "volatile");

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Line Variant</h3>
        <div className="flex flex-wrap items-center gap-4">
          <Sparkline data={upData} variant="line" tone="positive" size="md" ariaLabel="Trending up" />
          <Sparkline data={downData} variant="line" tone="negative" size="md" ariaLabel="Trending down" />
          <Sparkline data={flatData} variant="line" tone="neutral" size="md" ariaLabel="Flat" />
          <Sparkline data={volatileData} variant="line" tone="info" size="md" ariaLabel="Volatile" />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Area Variant</h3>
        <div className="flex flex-wrap items-center gap-4">
          <Sparkline data={upData} variant="area" tone="positive" size="md" ariaLabel="Trending up" />
          <Sparkline data={downData} variant="area" tone="negative" size="md" ariaLabel="Trending down" />
          <Sparkline data={flatData} variant="area" tone="neutral" size="md" ariaLabel="Flat" />
          <Sparkline data={volatileData} variant="area" tone="info" size="md" ariaLabel="Volatile" />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Bar Variant</h3>
        <div className="flex flex-wrap items-center gap-4">
          <Sparkline data={upData} variant="bar" tone="positive" size="md" ariaLabel="Trending up" />
          <Sparkline data={downData} variant="bar" tone="negative" size="md" ariaLabel="Trending down" />
          <Sparkline data={flatData} variant="bar" tone="neutral" size="md" ariaLabel="Flat" />
          <Sparkline data={volatileData} variant="bar" tone="info" size="md" ariaLabel="Volatile" />
        </div>
      </div>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-16">Small</span>
        <Sparkline data={upData} variant="line" tone="positive" size="sm" />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-16">Medium</span>
        <Sparkline data={upData} variant="line" tone="positive" size="md" />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-16">Large</span>
        <Sparkline data={upData} variant="line" tone="positive" size="lg" />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-16">X-Large</span>
        <Sparkline data={upData} variant="line" tone="positive" size="xl" />
      </div>
    </div>
  ),
};

export const WithLastPoint: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">With last point</span>
        <Sparkline data={upData} variant="line" tone="positive" size="md" showLastPoint />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">Without last point</span>
        <Sparkline data={upData} variant="line" tone="positive" size="md" showLastPoint={false} />
      </div>
    </div>
  ),
};

export const InMetricCards: Story = {
  render: () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl">
      <SparklineWithValue
        label="Revenue (24h)"
        value={12_345.67}
        data={upData}
        delta={5.2}
        deltaAsPercent
        variant="area"
        tone="positive"
        formatValue={(v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      />
      <SparklineWithValue
        label="Active Users"
        value={45_670}
        data={upData}
        delta={-1.3}
        deltaAsPercent
        variant="line"
        tone="negative"
        formatValue={(v) => v.toLocaleString()}
      />
      <SparklineWithValue
        label="Error Rate"
        value={2.1}
        data={downData}
        delta={-0.5}
        deltaAsPercent
        variant="area"
        tone="positive"
        formatValue={(v) => `${v.toFixed(1)}%`}
      />
      <SparklineWithValue
        label="Avg Latency"
        value={245}
        data={volatileData}
        delta={12.3}
        deltaAsPercent
        variant="line"
        tone="negative"
        formatValue={(v) => `${v}ms`}
      />
    </div>
  ),
};

export const InTable: Story = {
  render: () => (
    <table className="w-full border-collapse text-sm max-w-2xl">
      <thead>
        <tr className="border-b border-border">
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Trend (7d)</th>
          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Current</th>
          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Change</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-border/50">
          <td className="px-3 py-2">Revenue</td>
          <td className="px-3 py-2">
            <Sparkline data={upData} variant="line" tone="positive" size="sm" showLastPoint />
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums">$12,345.67</td>
          <td className="px-3 py-2 text-right">
            <DeltaIndicator value={5.2} asPercent showIcon variant="inline" size="sm" />
          </td>
        </tr>
        <tr className="border-b border-border/50">
          <td className="px-3 py-2">Active Channels</td>
          <td className="px-3 py-2">
            <Sparkline data={upData} variant="line" tone="positive" size="sm" showLastPoint />
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums">47</td>
          <td className="px-3 py-2 text-right">
            <DeltaIndicator value={2} showIcon variant="inline" size="sm" />
          </td>
        </tr>
        <tr className="border-b border-border/50">
          <td className="px-3 py-2">Error Rate</td>
          <td className="px-3 py-2">
            <Sparkline data={downData} variant="line" tone="positive" size="sm" showLastPoint />
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums">2.1%</td>
          <td className="px-3 py-2 text-right">
            <DeltaIndicator value={-0.5} asPercent showIcon variant="inline" size="sm" />
          </td>
        </tr>
        <tr className="border-b border-border/50">
          <td className="px-3 py-2">Avg Cost/Call</td>
          <td className="px-3 py-2">
            <Sparkline data={volatileData} variant="line" tone="negative" size="sm" showLastPoint />
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums">$0.000045</td>
          <td className="px-3 py-2 text-right">
            <DeltaIndicator value={0.3} asPercent showIcon variant="inline" size="sm" />
          </td>
        </tr>
      </tbody>
    </table>
  ),
};

export const WithCustomFormat: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-48">Currency format</span>
        <SparklineWithValue
          value={1_234_567}
          data={upData}
          formatValue={(v) => `$${(v / 1_000_000).toFixed(2)}M`}
          variant="area"
          tone="positive"
        />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-48">Percentage format</span>
        <SparklineWithValue
          value={98.5}
          data={upData}
          formatValue={(v) => `${v.toFixed(1)}%`}
          variant="line"
          tone="positive"
        />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-48">Compact format</span>
        <SparklineWithValue
          value={1_234_567_890}
          data={upData}
          formatValue={(v) => v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(1)}B` : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${(v / 1_000).toFixed(1)}K`}
          variant="area"
          tone="positive"
        />
      </div>
    </div>
  ),
};

export const EmptyStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">Empty data</span>
        <Sparkline data={[]} variant="line" size="md" />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">Single point</span>
        <Sparkline data={[100]} variant="line" size="md" />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">Two points</span>
        <Sparkline data={[100, 110]} variant="line" size="md" />
      </div>
    </div>
  ),
};

export const AnimationControl: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">No animation</span>
        <Sparkline data={upData} variant="line" tone="positive" size="md" animationDuration={0} />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">Fast (150ms)</span>
        <Sparkline data={upData} variant="line" tone="positive" size="md" animationDuration={150} />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">Default (300ms)</span>
        <Sparkline data={upData} variant="line" tone="positive" size="md" animationDuration={300} />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground w-32">Slow (600ms)</span>
        <Sparkline data={upData} variant="line" tone="positive" size="md" animationDuration={600} />
      </div>
    </div>
  ),
};