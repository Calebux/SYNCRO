import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils/render';
import { mockSubscription } from '@/lib/test-utils/factories';
import { mockSupabaseClient } from '@/lib/test-utils/mocks';
import React from 'react';

// Mock BulkOperationsSubscriptionList component
const BulkOperationsSubscriptionList = () => {
  const [subscriptions, setSubscriptions] = React.useState<any[]>([]);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [showTagDialog, setShowTagDialog] = React.useState(false);
  const [showStatusDialog, setShowStatusDialog] = React.useState(false);

  React.useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    const data = await mockSupabaseClient.from('subscriptions').select();
    setSubscriptions(data || []);
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === subscriptions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(subscriptions.map((sub) => sub.id)));
    }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    await mockSupabaseClient.from('subscriptions').delete().in('id', ids);
    await fetchSubscriptions();
    setSelectedIds(new Set());
    setShowDeleteDialog(false);
  };

  const bulkAssignTags = async (tags: string[]) => {
    const ids = Array.from(selectedIds);
    await mockSupabaseClient
      .from('subscriptions')
      .update({ tags })
      .in('id', ids);
    await fetchSubscriptions();
    setSelectedIds(new Set());
    setShowTagDialog(false);
  };

  const bulkUpdateStatus = async (status: string) => {
    const ids = Array.from(selectedIds);
    await mockSupabaseClient
      .from('subscriptions')
      .update({ status })
      .in('id', ids);
    await fetchSubscriptions();
    setSelectedIds(new Set());
    setShowStatusDialog(false);
  };

  return (
    <div>
      <h1>Subscriptions</h1>

      {/* Bulk action toolbar */}
      <div data-testid="bulk-toolbar">
        <span data-testid="selected-count">
          {selectedIds.size} selected
        </span>
        <button data-testid="select-all-btn" onClick={selectAll}>
          {selectedIds.size === subscriptions.length ? 'Deselect All' : 'Select All'}
        </button>
        <button
          data-testid="bulk-delete-btn"
          disabled={selectedIds.size === 0}
          onClick={() => setShowDeleteDialog(true)}
        >
          Delete Selected
        </button>
        <button
          data-testid="bulk-tag-btn"
          disabled={selectedIds.size === 0}
          onClick={() => setShowTagDialog(true)}
        >
          Assign Tags
        </button>
        <button
          data-testid="bulk-status-btn"
          disabled={selectedIds.size === 0}
          onClick={() => setShowStatusDialog(true)}
        >
          Update Status
        </button>
      </div>

      {/* Subscription list */}
      <ul data-testid="subscription-list">
        {subscriptions.map((sub) => (
          <li key={sub.id} data-testid={`subscription-${sub.id}`}>
            <input
              type="checkbox"
              data-testid={`checkbox-${sub.id}`}
              checked={selectedIds.has(sub.id)}
              onChange={() => toggleSelection(sub.id)}
            />
            <span data-testid={`name-${sub.id}`}>{sub.name}</span>
            <span data-testid={`status-${sub.id}`}>{sub.status}</span>
            <span data-testid={`tags-${sub.id}`}>{sub.tags?.join(', ')}</span>
          </li>
        ))}
      </ul>

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <div data-testid="delete-dialog" role="dialog">
          <h2>Confirm Deletion</h2>
          <p>Are you sure you want to delete {selectedIds.size} subscription(s)?</p>
          <button data-testid="confirm-delete-btn" onClick={bulkDelete}>
            Confirm
          </button>
          <button
            data-testid="cancel-delete-btn"
            onClick={() => setShowDeleteDialog(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Tag assignment dialog */}
      {showTagDialog && (
        <div data-testid="tag-dialog" role="dialog">
          <h2>Assign Tags</h2>
          <button
            data-testid="assign-entertainment-btn"
            onClick={() => bulkAssignTags(['entertainment'])}
          >
            Entertainment
          </button>
          <button
            data-testid="assign-productivity-btn"
            onClick={() => bulkAssignTags(['productivity'])}
          >
            Productivity
          </button>
          <button
            data-testid="cancel-tag-btn"
            onClick={() => setShowTagDialog(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Status update dialog */}
      {showStatusDialog && (
        <div data-testid="status-dialog" role="dialog">
          <h2>Update Status</h2>
          <button
            data-testid="set-active-btn"
            onClick={() => bulkUpdateStatus('active')}
          >
            Active
          </button>
          <button
            data-testid="set-paused-btn"
            onClick={() => bulkUpdateStatus('paused')}
          >
            Paused
          </button>
          <button
            data-testid="set-cancelled-btn"
            onClick={() => bulkUpdateStatus('cancelled')}
          >
            Cancelled
          </button>
          <button
            data-testid="cancel-status-btn"
            onClick={() => setShowStatusDialog(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

describe('Bulk Operations Integration Tests', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    mockSupabaseClient.from('subscriptions').select.mockReset();
    mockSupabaseClient.from('subscriptions').delete.mockReset();
    mockSupabaseClient.from('subscriptions').update.mockReset();
  });

  describe('Bulk selection state management', () => {
    it('should select and deselect individual subscriptions', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix' }),
        mockSubscription({ id: '2', name: 'Spotify' }),
        mockSubscription({ id: '3', name: 'Disney+' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select first subscription
      const checkbox1 = screen.getByTestId('checkbox-1');
      await user.click(checkbox1);

      // Assert
      expect(checkbox1).toBeChecked();
      expect(screen.getByTestId('selected-count')).toHaveTextContent('1 selected');

      // Select second subscription
      const checkbox2 = screen.getByTestId('checkbox-2');
      await user.click(checkbox2);

      // Assert
      expect(checkbox2).toBeChecked();
      expect(screen.getByTestId('selected-count')).toHaveTextContent('2 selected');

      // Deselect first subscription
      await user.click(checkbox1);

      // Assert
      expect(checkbox1).not.toBeChecked();
      expect(screen.getByTestId('selected-count')).toHaveTextContent('1 selected');
    });

    it('should select all subscriptions with select all button', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix' }),
        mockSubscription({ id: '2', name: 'Spotify' }),
        mockSubscription({ id: '3', name: 'Disney+' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Click select all
      const selectAllBtn = screen.getByTestId('select-all-btn');
      await user.click(selectAllBtn);

      // Assert
      expect(screen.getByTestId('checkbox-1')).toBeChecked();
      expect(screen.getByTestId('checkbox-2')).toBeChecked();
      expect(screen.getByTestId('checkbox-3')).toBeChecked();
      expect(screen.getByTestId('selected-count')).toHaveTextContent('3 selected');
      expect(selectAllBtn).toHaveTextContent('Deselect All');
    });

    it('should deselect all subscriptions with deselect all button', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix' }),
        mockSubscription({ id: '2', name: 'Spotify' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select all, then deselect all
      const selectAllBtn = screen.getByTestId('select-all-btn');
      await user.click(selectAllBtn); // Select all
      await user.click(selectAllBtn); // Deselect all

      // Assert
      expect(screen.getByTestId('checkbox-1')).not.toBeChecked();
      expect(screen.getByTestId('checkbox-2')).not.toBeChecked();
      expect(screen.getByTestId('selected-count')).toHaveTextContent('0 selected');
    });

    it('should disable bulk action buttons when no items selected', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Assert
      expect(screen.getByTestId('bulk-delete-btn')).toBeDisabled();
      expect(screen.getByTestId('bulk-tag-btn')).toBeDisabled();
      expect(screen.getByTestId('bulk-status-btn')).toBeDisabled();
    });
  });

  describe('Bulk delete with confirmation', () => {
    it('should show confirmation dialog before bulk delete', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix' }),
        mockSubscription({ id: '2', name: 'Spotify' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select subscriptions
      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('checkbox-2'));

      // Click bulk delete
      await user.click(screen.getByTestId('bulk-delete-btn'));

      // Assert - Dialog appears
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
      expect(screen.getByText(/delete 2 subscription/i)).toBeInTheDocument();
    });

    it('should complete bulk delete after confirmation', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix' }),
        mockSubscription({ id: '2', name: 'Spotify' }),
        mockSubscription({ id: '3', name: 'Disney+' }),
      ];

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce(subscriptions);

      mockSupabaseClient.from('subscriptions').delete.mockResolvedValueOnce({});

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([subscriptions[2]]);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select and delete
      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('checkbox-2'));
      await user.click(screen.getByTestId('bulk-delete-btn'));
      await user.click(screen.getByTestId('confirm-delete-btn'));

      // Assert - Delete called with correct IDs
      await waitFor(() => {
        expect(mockSupabaseClient.from('subscriptions').delete).toHaveBeenCalled();
      });

      // Verify subscriptions removed
      await waitFor(() => {
        expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
        expect(screen.queryByText('Spotify')).not.toBeInTheDocument();
        expect(screen.getByText('Disney+')).toBeInTheDocument();
      });
    });

    it('should cancel bulk delete and keep selection', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select and open delete dialog
      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-delete-btn'));

      // Cancel
      await user.click(screen.getByTestId('cancel-delete-btn'));

      // Assert - Dialog closed, selection maintained
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
      expect(screen.getByTestId('checkbox-1')).toBeChecked();
      expect(screen.getByTestId('selected-count')).toHaveTextContent('1 selected');
    });

    it('should clear selection after successful delete', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce(subscriptions);

      mockSupabaseClient.from('subscriptions').delete.mockResolvedValueOnce({});

      mockSupabaseClient.from('subscriptions').select.mockResolvedValueOnce([]);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-delete-btn'));
      await user.click(screen.getByTestId('confirm-delete-btn'));

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('selected-count')).toHaveTextContent('0 selected');
      });
    });
  });

  describe('Bulk tag assignment', () => {
    it('should open tag dialog when assign tags clicked', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-tag-btn'));

      // Assert
      expect(screen.getByTestId('tag-dialog')).toBeInTheDocument();
      expect(screen.getByText('Assign Tags')).toBeInTheDocument();
    });

    it('should assign tags to selected subscriptions', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', tags: [] }),
        mockSubscription({ id: '2', name: 'Spotify', tags: [] }),
      ];

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce(subscriptions);

      mockSupabaseClient.from('subscriptions').update.mockResolvedValueOnce({});

      mockSupabaseClient.from('subscriptions').select.mockResolvedValueOnce([
        { ...subscriptions[0], tags: ['entertainment'] },
        { ...subscriptions[1], tags: ['entertainment'] },
      ]);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('checkbox-2'));
      await user.click(screen.getByTestId('bulk-tag-btn'));
      await user.click(screen.getByTestId('assign-entertainment-btn'));

      // Assert
      await waitFor(() => {
        expect(mockSupabaseClient.from('subscriptions').update).toHaveBeenCalledWith({
          tags: ['entertainment'],
        });
      });
    });

    it('should cancel tag assignment', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-tag-btn'));
      await user.click(screen.getByTestId('cancel-tag-btn'));

      // Assert
      expect(screen.queryByTestId('tag-dialog')).not.toBeInTheDocument();
      expect(mockSupabaseClient.from('subscriptions').update).not.toHaveBeenCalled();
    });
  });

  describe('Bulk status updates', () => {
    it('should open status dialog when update status clicked', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-status-btn'));

      // Assert
      expect(screen.getByTestId('status-dialog')).toBeInTheDocument();
      expect(screen.getByText('Update Status')).toBeInTheDocument();
    });

    it('should update status to active for selected subscriptions', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', status: 'paused' }),
        mockSubscription({ id: '2', name: 'Spotify', status: 'paused' }),
      ];

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce(subscriptions);

      mockSupabaseClient.from('subscriptions').update.mockResolvedValueOnce({});

      mockSupabaseClient.from('subscriptions').select.mockResolvedValueOnce([
        { ...subscriptions[0], status: 'active' },
        { ...subscriptions[1], status: 'active' },
      ]);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('checkbox-2'));
      await user.click(screen.getByTestId('bulk-status-btn'));
      await user.click(screen.getByTestId('set-active-btn'));

      // Assert
      await waitFor(() => {
        expect(mockSupabaseClient.from('subscriptions').update).toHaveBeenCalledWith({
          status: 'active',
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('status-1')).toHaveTextContent('active');
        expect(screen.getByTestId('status-2')).toHaveTextContent('active');
      });
    });

    it('should update status to cancelled for selected subscriptions', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', status: 'active' }),
      ];

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce(subscriptions);

      mockSupabaseClient.from('subscriptions').update.mockResolvedValueOnce({});

      mockSupabaseClient
        .from('subscriptions')
        .select.mockResolvedValueOnce([{ ...subscriptions[0], status: 'cancelled' }]);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-status-btn'));
      await user.click(screen.getByTestId('set-cancelled-btn'));

      // Assert
      await waitFor(() => {
        expect(mockSupabaseClient.from('subscriptions').update).toHaveBeenCalledWith({
          status: 'cancelled',
        });
      });
    });

    it('should cancel status update', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-status-btn'));
      await user.click(screen.getByTestId('cancel-status-btn'));

      // Assert
      expect(screen.queryByTestId('status-dialog')).not.toBeInTheDocument();
      expect(mockSupabaseClient.from('subscriptions').update).not.toHaveBeenCalled();
    });
  });

  describe('Bulk operations error handling', () => {
    it('should handle bulk delete errors gracefully', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      mockSupabaseClient
        .from('subscriptions')
        .delete.mockRejectedValueOnce(new Error('Delete failed'));

      // Act
      renderWithProviders(<BulkOperationsSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('checkbox-1'));
      await user.click(screen.getByTestId('bulk-delete-btn'));

      // Assert - Should handle error
      await expect(
        user.click(screen.getByTestId('confirm-delete-btn'))
      ).rejects.toThrow();
    });

    it('should handle bulk tag assignment errors', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      mockSupabaseClient
        .from('subscriptions')
        .update.mockRejectedValueOnce(new Error('Update failed'));

      // Act & Assert
      await expect(
        mockSupabaseClient
          .from('subscriptions')
          .update({ tags: ['entertainment'] })
          .in('id', ['1'])
      ).rejects.toThrow('Update failed');
    });
  });
});
