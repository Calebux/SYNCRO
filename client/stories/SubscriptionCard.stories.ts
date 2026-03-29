import type { Meta, StoryObj } from '@storybook/react';
import { SubscriptionCard } from '../components/pages/subscriptions';

const meta: Meta<typeof SubscriptionCard> = {
  title: 'Subscriptions/SubscriptionCard',
  component: SubscriptionCard,
  args: {
    selectedSubscriptions: new Set<number>(),
    onToggleSelect: () => {},
    onDelete: () => {},
    onManage: () => {},
    darkMode: false,
  },
};

export default meta;
type Story = StoryObj<typeof SubscriptionCard>;

export const Active: Story = {
  args: {
    subscription: {
      id: 1,
      name: 'Netflix',
      price: 17.99,
      status: 'active',
      renewsIn: 7,
      icon: '🎬',
      category: 'Streaming',
      email: 'user@example.com',
    },
  },
};

export const ExpiringSoon: Story = {
  args: {
    subscription: {
      id: 2,
      name: 'Spotify',
      price: 10.99,
      status: 'expiring',
      renewsIn: 2,
      icon: '🎵',
      category: 'Streaming',
      email: 'user@example.com',
    },
  },
};

export const Trial: Story = {
  args: {
    subscription: {
      id: 3,
      name: 'ChatGPT Plus',
      price: 20,
      status: 'active',
      renewsIn: 14,
      isTrial: true,
      trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      priceAfterTrial: 20,
      icon: '🤖',
      category: 'AI Tools',
    },
  },
};

export const HighRisk: Story = {
  args: {
    subscription: {
      id: 4,
      name: 'AWS',
      price: 50,
      status: 'active',
      renewsIn: 12,
      risk_score: 0.9,
      icon: '☁️',
      category: 'Development',
    },
  },
};
