import type { Meta, StoryObj } from "@storybook/react";
import { DataTable } from "@syncro/ui";

const meta = {
  title: "Data/DataTable",
  component: DataTable,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    containerHeight: { control: "number" },
    rowHeight: { control: "number" },
    selectable: { control: "boolean" },
    selectionMode: { control: "select", options: ["single", "multi"] },
    isLoading: { control: "boolean" },
    showRowNumbers: { control: "boolean" },
    stickyHeader: { control: "boolean" },
  },
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

interface ChannelRow {
  id: string;
  name: string;
  provider: string;
  status: "healthy" | "degraded" | "failing";
  balance: number;
  nonce: number;
  calls24h: number;
  costPerCall: number;
  margin: number;
  lastActivity: string;
}

const mockChannels: ChannelRow[] = Array.from({ length: 50 }, (_, i) => ({
  id: `ch-${i + 1}`,
  name: `Channel ${i + 1}`,
  provider: ["Stripe", "Coinbase", "Circle", "Fireblocks", "Anchorage"][i % 5],
  status: ["healthy", "degraded", "failing", "healthy", "healthy"][i % 5] as ChannelRow["status"],
  balance: Math.floor(Math.random() * 1_000_000_000) + 10_000_000,
  nonce: Math.floor(Math.random() * 10000),
  calls24h: Math.floor(Math.random() * 10000),
  costPerCall: Math.random() * 0.01,
  margin: (Math.random() - 0.3) * 100,
  lastActivity: new Date(Date.now() - Math.random() * 86400000).toISOString(),
}));

const columns = [
  { id: "name", header: "Channel", accessor: "name" as keyof ChannelRow, minWidth: 150 },
  { id: "provider", header: "Provider", accessor: "provider" as keyof ChannelRow, minWidth: 120 },
  {
    id: "status",
    header: "Status",
    accessor: "status" as keyof ChannelRow,
    cell: (value: string) => (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
          value === "healthy" ? "bg-green-100 text-green-700" :
          value === "degraded" ? "bg-amber-100 text-amber-700" :
          "bg-red-100 text-red-700"
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${value === "healthy" ? "bg-green-500" : value === "degraded" ? "bg-amber-500" : "bg-red-500"}`} />
        {value.charAt(0).toUpperCase() + value.slice(1)}
      </span>
    ),
    minWidth: 100,
  },
  {
    id: "balance",
    header: "Balance",
    accessor: "balance" as keyof ChannelRow,
    cell: (value: number) => (
      <span className="font-mono tabular-nums">${(value / 1_000_000).toFixed(2)} USDC</span>
    ),
    align: "right",
    sortable: true,
    minWidth: 130,
  },
  {
    id: "nonce",
    header: "Nonce",
    accessor: "nonce" as keyof ChannelRow,
    cell: (value: number) => <span className="font-mono tabular-nums">{value.toLocaleString()}</span>,
    align: "right",
    sortable: true,
    minWidth: 80,
  },
  {
    id: "calls24h",
    header: "Calls (24h)",
    accessor: "calls24h" as keyof ChannelRow,
    cell: (value: number) => <span className="font-mono tabular-nums">{value.toLocaleString()}</span>,
    align: "right",
    sortable: true,
    minWidth: 100,
  },
  {
    id: "costPerCall",
    header: "Cost/Call",
    accessor: "costPerCall" as keyof ChannelRow,
    cell: (value: number) => <span className="font-mono tabular-nums">${value.toFixed(6)}</span>,
    align: "right",
    sortable: true,
    minWidth: 100,
  },
  {
    id: "margin",
    header: "Margin %",
    accessor: "margin" as keyof ChannelRow,
    cell: (value: number) => (
      <span className={`font-mono tabular-nums ${value >= 0 ? "text-green-600" : "text-red-600"}`}>
        {value >= 0 ? "+" : ""}{value.toFixed(1)}%
      </span>
    ),
    align: "right",
    sortable: true,
    minWidth: 90,
  },
  { id: "lastActivity", header: "Last Activity", accessor: "lastActivity" as keyof ChannelRow, minWidth: 160 },
];

export const Default: Story = {
  args: {
    columns,
    data: mockChannels,
    containerHeight: 400,
    selectable: true,
    showRowNumbers: true,
    ariaLabel: "Payment channels",
  },
};

export const WithSelection: Story = {
  args: {
    ...Default.args,
    selectionMode: "multi",
  },
};

export const Loading: Story = {
  args: {
    ...Default.args,
    isLoading: true,
    data: [],
  },
};

export const Empty: Story = {
  args: {
    ...Default.args,
    data: [],
    emptyState: {
      icon: "📭",
      title: "No channels",
      description: "Create a payment channel to get started.",
    },
  },
};

export const Error: Story = {
  args: {
    ...Default.args,
    data: [],
    error: "Failed to load channels. Please check your connection.",
  },
};

export const SingleSelect: Story = {
  args: {
    ...Default.args,
    selectionMode: "single",
  },
};

export const Compact: Story = {
  args: {
    ...Default.args,
    rowHeight: 36,
    containerHeight: 300,
    showRowNumbers: false,
  },
};