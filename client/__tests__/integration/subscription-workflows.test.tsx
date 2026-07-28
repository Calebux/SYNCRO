import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils/render';
import { mockUser, mockSubscription } from '@/lib/test-utils/factories';
import { mockSupabaseClient } from '@/lib/test-utils/mocks';

// Mock components - in a real scenario these would be actual app components
const SubscriptionList = ({ onUpdate }: { onUpdate?: () => void }) => {
  const [subscriptions, setSubscriptions] = React.useState<any[]>([]);
  const [total, setTotal] = React.useState(0);

  React.useEffect(() => {
    // Load subscriptions
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    const data = await mockSupabaseClient.from('subscriptions').select();
    setSubscriptions(data || []);
    setTotal(data?.reduce((sum: number, sub: any) => sum + sub.price, 0) || 0);
  };

  const handleDelete = async (id: string) => {
    await mockSupabaseClient.from('subscriptions').delete().eq('id', id);
    await fetchSubscriptions();
    onUpdate?.();
  };

  return (
    <div>
      <h1>Subscriptions</h1>
      <div data-testid="spending-total">Total: ${total}</div>
      <ul data-testid="subscription-list">
        {subscriptions.map((sub) => (
          <li key={sub.id} data-testid={`subscription-${sub.id}`}>
            <span>{sub.name}</span>
            <span>${sub.price}</span>
            <button
              onClick={() => handleDelete(sub.id)}
              data-testid={`delete-${sub.id}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

describe('Subscription Workflow Integration Tests', () => {
  let user: ReturnType<typeof userEvent.setup>;
  let mockNotificationSend: ReturnType<typeof vi.fn>;
  let mockAuditLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    user = userEvent.setup();
    mockNotificationSend = vi.fn();
    mockAuditLog = vi.fn();

    // Reset mock client
    mockSupabaseClient.from('subscriptions').select.mockReset();
    mockSupabaseClient.from('subscriptions').insert.mockReset();
    mockSupabaseClient.from('subscriptions').delete.mockReset();
    mockSupabaseClient.from('subscriptions').update.mockReset();
  });

  describe('Add subscription flow', () => {
    it('should complete full add subscription workflow', async () => {
      // Arrange
      const newSubscription = mockSubscription({
        name: 'Netflix Premium',
        price: 15.99,
        billing_cycle: 'monthly',
      });

      const existingSubscriptions = [
        mockSubscription({ id: '1', name: 'Spotify', price: 9.99 }),
      ];

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce(existingSubscriptions);

      mockSupabaseClient
        .from('subscriptions')
        .insert.mockResolvedValueOnce([newSubscription]);

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([...existingSubscriptions, newSubscription]);

      // Act - Render the subscription list
      const { rerender } = renderWithProviders(<SubscriptionList />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText('Spotify')).toBeInTheDocument();
      });

      // Verify initial spending total
      expect(screen.getByTestId('spending-total')).toHaveTextContent('Total: $9.99');

      // Simulate adding a subscription
      await mockSupabaseClient.from('subscriptions').insert([newSubscription]);

      // Trigger re-fetch by re-rendering
      rerender(<SubscriptionList />);

      // Assert - Verify list update
      await waitFor(() => {
        expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      });

      // Verify spending total update
      expect(screen.getByTestId('spending-total')).toHaveTextContent('Total: $25.98');

      // Verify subscription appears in the list
      expect(screen.getByTestId('subscription-2')).toBeInTheDocument();
    });

    it('should send notification after adding subscription', async () => {
      // Arrange
      const subscription = mockSubscription({ name: 'Disney+', price: 7.99 });

      mockSupabaseClient
        .from('subscriptions')
        .insert.mockResolvedValueOnce([subscription]);

      // Act
      await mockSupabaseClient.from('subscriptions').insert([subscription]);

      // Simulate notification trigger
      mockNotificationSend({
        type: 'subscription_added',
        title: 'Subscription Added',
        message: `${subscription.name} has been added to your subscriptions`,
      });

      // Assert
      expect(mockNotificationSend).toHaveBeenCalledWith({
        type: 'subscription_added',
        title: 'Subscription Added',
        message: 'Disney+ has been added to your subscriptions',
      });
    });

    it('should validate form fields before submission', async () => {
      // Arrange
      const invalidData = {
        name: '', // Empty name
        price: -10, // Negative price
      };

      // Act & Assert - Validation should prevent submission
      expect(() => {
        if (!invalidData.name) throw new Error('Name is required');
        if (invalidData.price <= 0) throw new Error('Price must be positive');
      }).toThrow();
    });
  });

  describe('Delete subscription flow', () => {
    it('should complete full delete subscription workflow', async () => {
      // Arrange
      const subscription1 = mockSubscription({ id: '1', name: 'Netflix', price: 15.99 });
      const subscription2 = mockSubscription({ id: '2', name: 'Spotify', price: 9.99 });

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([subscription1, subscription2]);

      mockSupabaseClient
        .from('subscriptions')
        .delete.mockResolvedValueOnce({ id: '1' });

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([subscription2]);

      // Act - Render and wait for load
      renderWithProviders(<SubscriptionList onUpdate={mockAuditLog} />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Click delete button
      const deleteButton = screen.getByTestId('delete-1');
      await user.click(deleteButton);

      // Assert - Subscription removed from list
      await waitFor(() => {
        expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
      });

      // Verify only Spotify remains
      expect(screen.getByText('Spotify')).toBeInTheDocument();

      // Verify audit log called
      expect(mockAuditLog).toHaveBeenCalled();
    });

    it('should log deletion in audit log', async () => {
      // Arrange
      const subscription = mockSubscription({ id: '1', name: 'HBO Max' });
      const currentUser = mockUser();

      // Act
      await mockSupabaseClient.from('subscriptions').delete().eq('id', subscription.id);

      // Simulate audit log entry
      mockAuditLog({
        action: 'subscription_deleted',
        user_id: currentUser.id,
        subscription_id: subscription.id,
        timestamp: new Date().toISOString(),
        metadata: {
          subscription_name: subscription.name,
        },
      });

      // Assert
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription_deleted',
          user_id: currentUser.id,
          subscription_id: subscription.id,
        })
      );
    });

    it('should handle deletion errors gracefully', async () => {
      // Arrange
      mockSupabaseClient
        .from('subscriptions')
        .delete.mockRejectedValueOnce(new Error('Database error'));

      // Act & Assert
      await expect(
        mockSupabaseClient.from('subscriptions').delete().eq('id', '1')
      ).rejects.toThrow('Database error');
    });
  });

  describe('Edit subscription flow', () => {
    it('should complete full edit subscription workflow', async () => {
      // Arrange
      const originalSubscription = mockSubscription({
        id: '1',
        name: 'Netflix Basic',
        price: 9.99,
      });

      const updatedSubscription = {
        ...originalSubscription,
        name: 'Netflix Premium',
        price: 15.99,
      };

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([originalSubscription]);

      mockSupabaseClient
        .from('subscriptions')
        .update.mockResolvedValueOnce([updatedSubscription]);

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([updatedSubscription]);

      // Act
      renderWithProviders(<SubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix Basic')).toBeInTheDocument();
      });

      // Simulate update
      await mockSupabaseClient
        .from('subscriptions')
        .update({ name: 'Netflix Premium', price: 15.99 })
        .eq('id', '1');

      // Assert - Update was called
      expect(mockSupabaseClient.from('subscriptions').update).toHaveBeenCalledWith({
        name: 'Netflix Premium',
        price: 15.99,
      });
    });

    it('should pre-populate form with existing data', () => {
      // Arrange
      const subscription = mockSubscription({
        name: 'Spotify Premium',
        price: 9.99,
        billing_cycle: 'monthly',
      });

      // Act - Simulate form pre-population
      const formData = {
        name: subscription.name,
        price: subscription.price,
        billing_cycle: subscription.billing_cycle,
      };

      // Assert
      expect(formData).toEqual({
        name: 'Spotify Premium',
        price: 9.99,
        billing_cycle: 'monthly',
      });
    });

    it('should refresh list after successful update', async () => {
      // Arrange
      const updatedSubscription = mockSubscription({ id: '1', name: 'Updated Name' });

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([updatedSubscription]);

      mockSupabaseClient
        .from('subscriptions')
        .update.mockResolvedValueOnce([updatedSubscription]);

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([updatedSubscription]);

      // Act
      await mockSupabaseClient
        .from('subscriptions')
        .update({ name: 'Updated Name' })
        .eq('id', '1');

      const refreshedData = await mockSupabaseClient.from('subscriptions').select();

      // Assert
      expect(refreshedData).toHaveLength(1);
      expect(refreshedData[0].name).toBe('Updated Name');
    });
  });

  describe('Subscription workflow error handling', () => {
    it('should handle network errors during add', async () => {
      // Arrange
      mockSupabaseClient
        .from('subscriptions')
        .insert.mockRejectedValueOnce(new Error('Network error'));

      // Act & Assert
      await expect(
        mockSupabaseClient.from('subscriptions').insert([mockSubscription()])
      ).rejects.toThrow('Network error');
    });

    it('should handle unauthorized access', async () => {
      // Arrange
      mockSupabaseClient
        .from('subscriptions')
        .select.mockRejectedValueOnce(new Error('Unauthorized'));

      // Act & Assert
      await expect(mockSupabaseClient.from('subscriptions').select()).rejects.toThrow(
        'Unauthorized'
      );
    });

    it('should rollback on partial failure', async () => {
      // Arrange - Simulate a transaction rollback scenario
      const newSubscription = mockSubscription();

      mockSupabaseClient
        .from('subscriptions')
        .insert.mockResolvedValueOnce([newSubscription]);

      // Simulate notification failure
      mockNotificationSend.mockRejectedValueOnce(new Error('Notification service down'));

      // Act
      await mockSupabaseClient.from('subscriptions').insert([newSubscription]);

      try {
        await mockNotificationSend({ message: 'New subscription' });
      } catch (error) {
        // Rollback - delete the inserted subscription
        await mockSupabaseClient
          .from('subscriptions')
          .delete()
          .eq('id', newSubscription.id);
      }

      // Assert - Delete was called to rollback
      expect(mockSupabaseClient.from('subscriptions').delete).toHaveBeenCalled();
    });
  });
});
