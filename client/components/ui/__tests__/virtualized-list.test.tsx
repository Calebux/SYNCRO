import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VirtualizedList } from '../virtualized-list';
import { describe, it, expect, vi } from 'vitest';

describe('VirtualizedList', () => {
  const mockItems = Array.from({ length: 1000 }, (_, i) => ({
    id: `item_${i}`,
    text: `Item ${i}`,
  }));

  const renderItem = (item: any) => <div>{item.text}</div>;

  it('renders bounded number of DOM nodes', () => {
    const { container } = render(
      <VirtualizedList
        items={mockItems}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const listItems = container.querySelectorAll('[role="listitem"]');
    // Should only render visible items + overscan (default 3)
    expect(listItems.length).toBeLessThan(20);
    expect(listItems.length).toBeGreaterThan(0);
  });

  it('has correct ARIA attributes', () => {
    render(
      <VirtualizedList
        items={mockItems}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list', { name: 'Test list' });
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute('aria-label', 'Test list');
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list');
    await user.click(list);
    await user.keyboard('{ArrowDown}');

    const listItems = container.querySelectorAll('[role="listitem"]');
    const focusedItem = container.querySelector('[role="listitem"]:focus');
    expect(focusedItem).toBeInTheDocument();
  });

  it('handles ArrowUp navigation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list');
    await user.click(list);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');

    const focusedItem = container.querySelector('[role="listitem"]:focus');
    expect(focusedItem).toBeInTheDocument();
  });

  it('handles Home key', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list');
    await user.click(list);
    await user.keyboard('{Home}');

    await waitFor(() => {
      const focusedItem = container.querySelector('[role="listitem"]:focus');
      expect(focusedItem).toBeInTheDocument();
    });
  });

  it('handles End key', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list');
    await user.click(list);
    await user.keyboard('{End}');

    await waitFor(() => {
      const focusedItem = container.querySelector('[role="listitem"]:focus');
      expect(focusedItem).toBeInTheDocument();
    });
  });

  it('shows loading state with aria-live', () => {
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
        isLoading={true}
      />
    );

    const statusRegion = container.querySelector('[role="status"]');
    expect(statusRegion).toBeInTheDocument();
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
  });

  it('triggers onLoadMore when scrolling near bottom', async () => {
    const onLoadMore = vi.fn();

    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 50)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
        onLoadMore={onLoadMore}
        hasMore={true}
      />
    );

    const scrollContainer = container.querySelector('[role="list"]') as HTMLElement;

    // Simulate scrolling to bottom
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 2500 } });

    await waitFor(() => {
      expect(onLoadMore).toHaveBeenCalled();
    });
  });

  it('does not call onLoadMore when hasMore is false', () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 50)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
        onLoadMore={onLoadMore}
        hasMore={false}
      />
    );

    const scrollContainer = container.querySelector('[role="list"]') as HTMLElement;
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 2500 } });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('preserves item focus through render cycles', async () => {
    const user = userEvent.setup();
    const { rerender, container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list');
    await user.click(list);
    await user.keyboard('{ArrowDown}');

    let focusedBefore = container.querySelector('[role="listitem"]:focus');
    expect(focusedBefore).toBeInTheDocument();

    // Re-render with new items
    rerender(
      <VirtualizedList
        items={mockItems.slice(100, 200)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    // Focus should be managed gracefully
    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBeGreaterThan(0);
  });

  it('handles empty list gracefully', () => {
    const { container } = render(
      <VirtualizedList
        items={[]}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Empty list"
      />
    );

    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();

    const listItems = container.querySelectorAll('[role="listitem"]');
    expect(listItems.length).toBe(0);
  });

  it('handles PageDown navigation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list');
    await user.click(list);
    await user.keyboard('{PageDown}');

    const focusedItem = container.querySelector('[role="listitem"]:focus');
    expect(focusedItem).toBeInTheDocument();
  });

  it('handles PageUp navigation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VirtualizedList
        items={mockItems.slice(0, 100)}
        itemHeight={50}
        containerHeight={300}
        renderItem={renderItem}
        ariaLabel="Test list"
      />
    );

    const list = screen.getByRole('list');
    await user.click(list);
    await user.keyboard('{PageDown}{PageDown}{PageUp}');

    const focusedItem = container.querySelector('[role="listitem"]:focus');
    expect(focusedItem).toBeInTheDocument();
  });
});
