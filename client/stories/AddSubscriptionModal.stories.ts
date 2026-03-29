import type { Meta, StoryObj } from '@storybook/react';
import AddSubscriptionModal from '../components/modals/add-subscription-modal';
import React from 'react';
const Wrapper = (args: any) => React.createElement(AddSubscriptionModal as any, args);

const meta: Meta<typeof Wrapper> = {
  title: 'Forms/AddSubscriptionModal',
  component: Wrapper,
  args: {
    darkMode: false,
    onAdd: () => {},
    onClose: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof Wrapper>;

export const EmptyState: Story = {
  args: {},
};

export const DarkMode: Story = {
  args: {
    darkMode: true,
  },
};

export const ValidationDisabled: Story = {
  args: {},
  parameters: {
    docs: {
      description: {
        story: 'Submit button is disabled until required fields are filled.',
      },
    },
  },
};
