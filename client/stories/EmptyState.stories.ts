import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from '../components/ui/empty-state';

const meta: Meta<typeof EmptyState> = {
  title: 'States/EmptyState',
  component: EmptyState,
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const FirstTimeDashboard: Story = {
  args: {
    icon: '📊',
    title: 'Welcome to SYNCRO',
    description: 'Get started by adding your first subscription or connecting your email.',
    action: {
      label: 'Add subscription',
      onClick: () => {},
    },
    darkMode: false,
  },
};
