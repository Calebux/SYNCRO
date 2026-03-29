import type { Meta, StoryObj } from '@storybook/react';
import NotificationsPanel from '../components/notifications-panel';

const meta: Meta<typeof NotificationsPanel> = {
  title: 'Notifications/Panel',
  component: NotificationsPanel,
  args: {
    darkMode: false,
    onClose: () => {},
    onMarkRead: () => {},
    onAddSubscription: () => {},
    onResolveAction: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof NotificationsPanel>;

export const Empty: Story = {
  args: {
    notifications: [],
  },
};

export const OneNotification: Story = {
  args: {
    notifications: [
      {
        id: 1,
        type: 'renewal',
        title: 'Upcoming Renewal',
        description: 'Netflix renews in 3 days.',
        read: false,
      },
    ],
  },
};

export const ManyNotifications: Story = {
  args: {
    notifications: Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      type: i % 2 === 0 ? 'duplicate' : 'unused',
      title: i % 2 === 0 ? 'Duplicate detected' : 'Unused subscription',
      description: i % 2 === 0 ? 'We found similar subscriptions.' : 'No usage detected in 30 days.',
      read: i % 3 === 0 ? false : true,
      duplicateInfo: i % 2 === 0 ? { groupId: `dup-${i}` } : undefined,
      subscriptionId: i % 2 !== 0 ? i + 100 : undefined,
    })),
  },
};
