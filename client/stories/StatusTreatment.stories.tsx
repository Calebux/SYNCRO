import type { Meta, StoryObj } from "@storybook/react";
import {
  StatusTreatment,
  StatusDot,
  StatusBadge,
  StatusBanner,
} from "@syncro/ui";

const meta = {
  title: "Data/StatusTreatment",
  component: StatusTreatment,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    level: { control: "select", options: ["healthy", "degraded", "failing", "unknown"] },
    variant: { control: "select", options: ["dot", "badge", "banner", "inline"] },
    size: { control: "select", options: ["sm", "md", "lg"] },
    pulse: { control: "boolean" },
    showIcon: { control: "boolean" },
  },
} satisfies Meta<typeof StatusTreatment>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllLevels: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <StatusTreatment level="healthy" label="Healthy" />
      <StatusTreatment level="degraded" label="Degraded" />
      <StatusTreatment level="failing" label="Failing" />
      <StatusTreatment level="unknown" label="Unknown" />
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-2">Dot variant</p>
        <div className="flex flex-wrap items-center gap-4">
          <StatusTreatment variant="dot" level="healthy" label="Healthy" />
          <StatusTreatment variant="dot" level="degraded" label="Degraded" />
          <StatusTreatment variant="dot" level="failing" label="Failing" />
          <StatusTreatment variant="dot" level="unknown" label="Unknown" />
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground mb-2">Inline variant</p>
        <div className="flex flex-wrap items-center gap-4">
          <StatusTreatment variant="inline" level="healthy" label="Healthy" />
          <StatusTreatment variant="inline" level="degraded" label="Degraded" />
          <StatusTreatment variant="inline" level="failing" label="Failing" />
          <StatusTreatment variant="inline" level="unknown" label="Unknown" />
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground mb-2">Badge variant</p>
        <div className="flex flex-wrap items-center gap-4">
          <StatusTreatment variant="badge" level="healthy" label="Healthy" />
          <StatusTreatment variant="badge" level="degraded" label="Degraded" />
          <StatusTreatment variant="badge" level="failing" label="Failing" />
          <StatusTreatment variant="badge" level="unknown" label="Unknown" />
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground mb-2">Banner variant</p>
        <div className="space-y-2 max-w-md">
          <StatusTreatment variant="banner" level="healthy" label="System Operational" description="All services running normally" />
          <StatusTreatment variant="banner" level="degraded" label="Degraded Performance" description="Elevated latency detected in us-east-1" />
          <StatusTreatment variant="banner" level="failing" label="Service Outage" description="Payment processing unavailable" />
          <StatusTreatment variant="banner" level="unknown" label="Status Unknown" description="Unable to reach monitoring endpoint" />
        </div>
      </div>
    </div>
  ),
};

export const WithPulse: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <StatusTreatment level="healthy" label="Live (pulsing)" pulse />
      <StatusTreatment level="degraded" label="Degraded (pulsing)" pulse />
      <StatusTreatment level="failing" label="Critical (pulsing)" pulse />
    </div>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <div className="space-y-4 max-w-md">
      <StatusTreatment
        variant="banner"
        level="healthy"
        label="Payment Channels Healthy"
        description="All 47 channels operational, 99.99% uptime"
      />
      <StatusTreatment
        variant="banner"
        level="degraded"
        label="Elevated Latency"
        description="p99 latency 2.4s (threshold: 2s) — investigating"
      />
      <StatusTreatment
        variant="banner"
        level="failing"
        label="Channel Settlement Failed"
        description="3 channels in retry loop, manual intervention required"
        action={
          <button className="ml-4 px-3 py-1 text-sm font-medium text-red-700 bg-red-100 rounded hover:bg-red-200">
            View Details
          </button>
        }
      />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Small</p>
        <StatusTreatment size="sm" level="healthy" label="Healthy" />
        <StatusTreatment size="sm" level="degraded" label="Degraded" />
        <StatusTreatment size="sm" level="failing" label="Failing" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Medium</p>
        <StatusTreatment size="md" level="healthy" label="Healthy" />
        <StatusTreatment size="md" level="degraded" label="Degraded" />
        <StatusTreatment size="md" level="failing" label="Failing" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Large</p>
        <StatusTreatment size="lg" level="healthy" label="Healthy" />
        <StatusTreatment size="lg" level="degraded" label="Degraded" />
        <StatusTreatment size="lg" level="failing" label="Failing" />
      </div>
    </div>
  ),
};

export const CustomLabels: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <StatusTreatment level="healthy" label="Operational" />
      <StatusTreatment level="healthy" label="✓ Verified" />
      <StatusTreatment level="degraded" label="Warning" />
      <StatusTreatment level="degraded" label="⚠ Attention" />
      <StatusTreatment level="failing" label="Critical" />
      <StatusTreatment level="failing" label="✗ Down" />
    </div>
  ),
};

// StatusDot stories
export const StatusDotVariants: StoryObj = {
  render: () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2">
          <StatusDot level="healthy" />
          <span>Healthy</span>
        </span>
        <span className="flex items-center gap-2">
          <StatusDot level="degraded" />
          <span>Degraded</span>
        </span>
        <span className="flex items-center gap-2">
          <StatusDot level="failing" />
          <span>Failing</span>
        </span>
        <span className="flex items-center gap-2">
          <StatusDot level="unknown" />
          <span>Unknown</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-xs text-muted-foreground">With pulse</p>
        <span className="flex items-center gap-2">
          <StatusDot level="healthy" pulse />
          <span>Healthy (live)</span>
        </span>
        <span className="flex items-center gap-2">
          <StatusDot level="failing" pulse />
          <span>Failing (critical)</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-xs text-muted-foreground">Sizes</p>
        <span className="flex items-center gap-2">
          <StatusDot level="healthy" size="sm" />
          <span>Small</span>
        </span>
        <span className="flex items-center gap-2">
          <StatusDot level="healthy" size="md" />
          <span>Medium</span>
        </span>
        <span className="flex items-center gap-2">
          <StatusDot level="healthy" size="lg" />
          <span>Large</span>
        </span>
      </div>
    </div>
  ),
};

// StatusBadge stories
export const StatusBadgeVariants: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge level="healthy" label="Active" />
      <StatusBadge level="degraded" label="Warning" />
      <StatusBadge level="failing" label="Error" />
      <StatusBadge level="unknown" label="Pending" />
    </div>
  ),
};

// StatusBanner stories
export const StatusBannerVariants: StoryObj = {
  render: () => (
    <div className="space-y-3 max-w-2xl">
      <StatusBanner
        level="healthy"
        label="All Systems Operational"
        description="No incidents reported in the last 24 hours"
      />
      <StatusBanner
        level="degraded"
        label="Degraded Performance"
        description="API latency elevated in eu-west-1 region"
        action={
          <button className="ml-4 px-3 py-1 text-sm font-medium text-amber-700 bg-amber-100 rounded hover:bg-amber-200">
            View Status Page
          </button>
        }
      />
      <StatusBanner
        level="failing"
        label="Major Outage"
        description="Payment processing is currently unavailable. Engineering team is investigating."
        action={
          <button className="ml-4 px-3 py-1 text-sm font-medium text-red-700 bg-red-100 rounded hover:bg-red-200">
            Subscribe to Updates
          </button>
        }
      />
    </div>
  ),
};

// In-table usage
export const InTable: Story = {
  render: () => (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Channel</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Provider</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-border/50">
          <td className="px-3 py-2">Channel 1</td>
          <td className="px-3 py-2">Stripe</td>
          <td className="px-3 py-2">
            <StatusDot level="healthy" tooltip="Channel healthy" />
            <span className="ml-2">Healthy</span>
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums">$1,234.56</td>
        </tr>
        <tr className="border-b border-border/50">
          <td className="px-3 py-2">Channel 2</td>
          <td className="px-3 py-2">Coinbase</td>
          <td className="px-3 py-2">
            <StatusDot level="degraded" tooltip="Elevated latency" />
            <span className="ml-2">Degraded</span>
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums">$987.65</td>
        </tr>
        <tr className="border-b border-border/50">
          <td className="px-3 py-2">Channel 3</td>
          <td className="px-3 py-2">Circle</td>
          <td className="px-3 py-2">
            <StatusDot level="failing" tooltip="Settlement failing" />
            <span className="ml-2">Failing</span>
          </td>
          <td className="px-3 py-2 text-right font-mono tabular-nums">$0.00</td>
        </tr>
      </tbody>
    </table>
  ),
};