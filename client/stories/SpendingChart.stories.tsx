import type { Meta, StoryObj } from '@storybook/react';
import { SpendChart } from '../components/spend-chart';

const sampleData = [
  { month: 'Jan', category: 'Food', amount: 450 },
  { month: 'Jan', category: 'Transport', amount: 120 },
  { month: 'Jan', category: 'Entertainment', amount: 80 },
  { month: 'Feb', category: 'Food', amount: 420 },
  { month: 'Feb', category: 'Transport', amount: 150 },
  { month: 'Feb', category: 'Entertainment', amount: 95 },
  { month: 'Mar', category: 'Food', amount: 480 },
  { month: 'Mar', category: 'Transport', amount: 110 },
  { month: 'Mar', category: 'Entertainment', amount: 120 },
  { month: 'Apr', category: 'Food', amount: 390 },
  { month: 'Apr', category: 'Transport', amount: 135 },
  { month: 'Apr', category: 'Entertainment', amount: 85 },
  { month: 'May', category: 'Food', amount: 510 },
  { month: 'May', category: 'Transport', amount: 125 },
  { month: 'May', category: 'Entertainment', amount: 140 },
  { month: 'Jun', category: 'Food', amount: 470 },
  { month: 'Jun', category: 'Transport', amount: 145 },
  { month: 'Jun', category: 'Entertainment', amount: 110 },
];

const meta: Meta<typeof SpendChart> = {
  title: 'Charts/SpendChart',
  component: SpendChart,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof SpendChart>;

export const Default: Story = {
  args: {
    data: sampleData,
  },
};

export const WithCustomCategories: Story = {
  args: {
    data: sampleData,
    categories: ['Food', 'Transport', 'Entertainment'],
  },
};
