import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils/render';
import { mockSubscription } from '@/lib/test-utils/factories';
import { mockSupabaseClient } from '@/lib/test-utils/mocks';
import React from 'react';

// Mock FilterableSubscriptionList component
const FilterableSubscriptionList = () => {
  const [subscriptions, setSubscriptions] = React.useState<any[]>([]);
  const [filteredSubscriptions, setFilteredSubscriptions] = React.useState<any[]>([]);
  const [selectedTag, setSelectedTag] = React.useState<string>('');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('');
  const [searchQuery, setSearchQuery] = React.useState<string>('');

  React.useEffect(() => {
    fetchSubscriptions();
  }, []);

  React.useEffect(() => {
    applyFilters();
  }, [subscriptions, selectedTag, selectedCategory, searchQuery]);

  const fetchSubscriptions = async () => {
    const data = await mockSupabaseClient.from('subscriptions').select();
    setSubscriptions(data || []);
  };

  const applyFilters = () => {
    let filtered = [...subscriptions];

    // Apply tag filter
    if (selectedTag) {
      filtered = filtered.filter((sub) => sub.tags?.includes(selectedTag));
    }

    // Apply category filter
    if (selectedCategory) {
      filtered = filtered.filter((sub) => sub.category === selectedCategory);
    }

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (sub) =>
          sub.name?.toLowerCase().includes(query) ||
          sub.merchant?.toLowerCase().includes(query) ||
          sub.notes?.toLowerCase().includes(query)
      );
    }

    setFilteredSubscriptions(filtered);
  };

  return (
    <div>
      <h1>Subscriptions</h1>

      {/* Filters */}
      <div data-testid="filters">
        <select
          data-testid="tag-filter"
          value={selectedTag}
          onChange={(e) => setSelectedTag(e.target.value)}
        >
          <option value="">All Tags</option>
          <option value="entertainment">Entertainment</option>
          <option value="productivity">Productivity</option>
          <option value="health">Health</option>
        </select>

        <select
          data-testid="category-filter"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          <option value="streaming">Streaming</option>
          <option value="software">Software</option>
          <option value="fitness">Fitness</option>
        </select>

        <input
          type="text"
          data-testid="search-input"
          placeholder="Search subscriptions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Results */}
      <div data-testid="results-count">
        Showing {filteredSubscriptions.length} of {subscriptions.length} subscriptions
      </div>

      <ul data-testid="subscription-list">
        {filteredSubscriptions.map((sub) => (
          <li key={sub.id} data-testid={`subscription-${sub.id}`}>
            <span data-testid={`name-${sub.id}`}>{sub.name}</span>
            <span data-testid={`category-${sub.id}`}>{sub.category}</span>
            <span data-testid={`tags-${sub.id}`}>{sub.tags?.join(', ')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

describe('Filtering and Search Integration Tests', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    mockSupabaseClient.from('subscriptions').select.mockReset();
  });

  describe('Tag filtering', () => {
    it('should filter subscriptions by tag and update UI', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({
          id: '1',
          name: 'Netflix',
          tags: ['entertainment', 'streaming'],
        }),
        mockSubscription({
          id: '2',
          name: 'Notion',
          tags: ['productivity', 'software'],
        }),
        mockSubscription({
          id: '3',
          name: 'Disney+',
          tags: ['entertainment', 'streaming'],
        }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select entertainment tag
      const tagFilter = screen.getByTestId('tag-filter');
      await user.selectOptions(tagFilter, 'entertainment');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 2 of 3 subscriptions'
        );
      });

      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.getByText('Disney+')).toBeInTheDocument();
      expect(screen.queryByText('Notion')).not.toBeInTheDocument();
    });

    it('should clear tag filter and show all subscriptions', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', tags: ['entertainment'] }),
        mockSubscription({ id: '2', name: 'Notion', tags: ['productivity'] }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select tag, then clear
      const tagFilter = screen.getByTestId('tag-filter');
      await user.selectOptions(tagFilter, 'entertainment');
      await user.selectOptions(tagFilter, '');

      // Assert - All subscriptions visible
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 2 of 2 subscriptions'
        );
      });
    });
  });

  describe('Category filtering', () => {
    it('should filter subscriptions by category and update UI', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', category: 'streaming' }),
        mockSubscription({ id: '2', name: 'Figma', category: 'software' }),
        mockSubscription({ id: '3', name: 'Spotify', category: 'streaming' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select streaming category
      const categoryFilter = screen.getByTestId('category-filter');
      await user.selectOptions(categoryFilter, 'streaming');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 2 of 3 subscriptions'
        );
      });

      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.getByText('Spotify')).toBeInTheDocument();
      expect(screen.queryByText('Figma')).not.toBeInTheDocument();
    });

    it('should handle empty category filter results', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', category: 'streaming' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Select category with no matches
      const categoryFilter = screen.getByTestId('category-filter');
      await user.selectOptions(categoryFilter, 'fitness');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 0 of 1 subscriptions'
        );
      });
    });
  });

  describe('Search functionality', () => {
    it('should search across name field and update UI', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix Premium' }),
        mockSubscription({ id: '2', name: 'Spotify' }),
        mockSubscription({ id: '3', name: 'HBO Max' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      });

      // Search for "net"
      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'net');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 1 of 3 subscriptions'
        );
      });

      expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      expect(screen.queryByText('Spotify')).not.toBeInTheDocument();
    });

    it('should search across merchant field and update UI', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Streaming Service', merchant: 'Netflix Inc' }),
        mockSubscription({ id: '2', name: 'Music Service', merchant: 'Spotify AB' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Streaming Service')).toBeInTheDocument();
      });

      // Search for merchant
      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'Spotify');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 1 of 2 subscriptions'
        );
      });

      expect(screen.getByText('Music Service')).toBeInTheDocument();
    });

    it('should search across notes field and update UI', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({
          id: '1',
          name: 'Service A',
          notes: 'Family plan for streaming',
        }),
        mockSubscription({ id: '2', name: 'Service B', notes: 'Personal account' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Service A')).toBeInTheDocument();
      });

      // Search in notes
      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'family');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 1 of 2 subscriptions'
        );
      });

      expect(screen.getByText('Service A')).toBeInTheDocument();
    });

    it('should handle case-insensitive search', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix Premium' }),
        mockSubscription({ id: '2', name: 'HBO Max' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      });

      // Search with uppercase
      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'NETFLIX');

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      });
    });
  });

  describe('Combined filters and search', () => {
    it('should apply tag filter and search together', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({
          id: '1',
          name: 'Netflix',
          tags: ['entertainment'],
          category: 'streaming',
        }),
        mockSubscription({
          id: '2',
          name: 'Notion',
          tags: ['productivity'],
          category: 'software',
        }),
        mockSubscription({
          id: '3',
          name: 'Disney+',
          tags: ['entertainment'],
          category: 'streaming',
        }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Apply tag filter
      const tagFilter = screen.getByTestId('tag-filter');
      await user.selectOptions(tagFilter, 'entertainment');

      // Apply search
      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'net');

      // Assert - Only Netflix matches both filters
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 1 of 3 subscriptions'
        );
      });

      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.queryByText('Disney+')).not.toBeInTheDocument();
    });

    it('should apply category filter and search together', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix Premium', category: 'streaming' }),
        mockSubscription({ id: '2', name: 'Spotify Premium', category: 'streaming' }),
        mockSubscription({ id: '3', name: 'Figma Pro', category: 'software' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      });

      // Apply category filter
      const categoryFilter = screen.getByTestId('category-filter');
      await user.selectOptions(categoryFilter, 'streaming');

      // Apply search
      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'premium');

      // Assert - Both Netflix and Spotify match
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 2 of 3 subscriptions'
        );
      });

      expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      expect(screen.getByText('Spotify Premium')).toBeInTheDocument();
    });

    it('should apply all filters (tag, category, search) together', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({
          id: '1',
          name: 'Netflix Premium',
          category: 'streaming',
          tags: ['entertainment'],
        }),
        mockSubscription({
          id: '2',
          name: 'Netflix Basic',
          category: 'streaming',
          tags: ['entertainment'],
        }),
        mockSubscription({
          id: '3',
          name: 'Spotify Premium',
          category: 'streaming',
          tags: ['entertainment'],
        }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      });

      // Apply all filters
      const tagFilter = screen.getByTestId('tag-filter');
      await user.selectOptions(tagFilter, 'entertainment');

      const categoryFilter = screen.getByTestId('category-filter');
      await user.selectOptions(categoryFilter, 'streaming');

      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'premium');

      // Assert - Only Netflix Premium matches all filters
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 1 of 3 subscriptions'
        );
      });

      expect(screen.getByText('Netflix Premium')).toBeInTheDocument();
      expect(screen.queryByText('Netflix Basic')).not.toBeInTheDocument();
      expect(screen.queryByText('Spotify Premium')).not.toBeInTheDocument();
    });

    it('should show no results when filters match nothing', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', category: 'streaming' }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Apply filters that match nothing
      const categoryFilter = screen.getByTestId('category-filter');
      await user.selectOptions(categoryFilter, 'software');

      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'Spotify');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('results-count')).toHaveTextContent(
          'Showing 0 of 1 subscriptions'
        );
      });
    });
  });

  describe('Filter persistence and reset', () => {
    it('should persist filters across re-renders', async () => {
      // Arrange
      const subscriptions = [
        mockSubscription({ id: '1', name: 'Netflix', tags: ['entertainment'] }),
        mockSubscription({ id: '2', name: 'Notion', tags: ['productivity'] }),
      ];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      const { rerender } = renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Apply filter
      const tagFilter = screen.getByTestId('tag-filter');
      await user.selectOptions(tagFilter, 'entertainment');

      // Rerender
      rerender(<FilterableSubscriptionList />);

      // Assert - Filter still applied
      expect(tagFilter).toHaveValue('entertainment');
    });

    it('should reset all filters when clear action triggered', async () => {
      // Arrange
      const subscriptions = [mockSubscription({ id: '1', name: 'Netflix' })];

      mockSupabaseClient.from('subscriptions').select.mockResolvedValue(subscriptions);

      // Act
      renderWithProviders(<FilterableSubscriptionList />);

      await waitFor(() => {
        expect(screen.getByText('Netflix')).toBeInTheDocument();
      });

      // Apply filters
      const tagFilter = screen.getByTestId('tag-filter');
      await user.selectOptions(tagFilter, 'entertainment');

      const searchInput = screen.getByTestId('search-input');
      await user.type(searchInput, 'test');

      // Clear filters
      await user.selectOptions(tagFilter, '');
      await user.clear(searchInput);

      // Assert
      expect(tagFilter).toHaveValue('');
      expect(searchInput).toHaveValue('');
    });
  });
});
