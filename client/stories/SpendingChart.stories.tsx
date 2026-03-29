import type { Meta, StoryObj } from '@storybook/react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function SpendingChart() {
  const data = [
    { month: 'Jan', spend: 40 },
    { month: 'Feb', spend: 42 },
    { month: 'Mar', spend: 45 },
    { month: 'Apr', spend: 47 },
    { month: 'May', spend: 50 },
    { month: 'Jun', spend: 52 },
    { month: 'Jul', spend: 55 },
    { month: 'Aug', spend: 58 },
    { month: 'Sep', spend: 60 },
    { month: 'Oct', spend: 63 },
    { month: 'Nov', spend: 65 },
    { month: 'Dec', spend: 68 },
  ];
  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip formatter={(value: number) => `$${value}`} />
          <Line type="monotone" dataKey="spend" stroke="#6366f1" strokeWidth={3} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const meta: Meta<typeof SpendingChart> = {
  title: 'Charts/SpendingChart',
  component: SpendingChart,
};

export default meta;
type Story = StoryObj<typeof SpendingChart>;

export const TwelveMonths: Story = {
  args: {},
};
