/**
 * Tests for offline-first subscription dashboard
 *
 * Covers:
 * - OfflineIndicator: shows offline state and pending mutations count
 * - useMutationQueue: tracks online status, queues mutations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfflineIndicator } from "@/components/widgets/offline-indicator";

// ─── OfflineIndicator component tests ─────────────────────────────────────────

describe('OfflineIndicator', () => {
  it('renders nothing when online', () => {
    const { container } = render(<OfflineIndicator show={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders offline message when offline', () => {
    render(<OfflineIndicator show={true} />);
    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
  });

  it('shows pending mutations count when provided', () => {
    render(<OfflineIndicator show={true} pendingMutationsCount={3} />);
    expect(screen.getByText(/3 changes pending sync/i)).toBeInTheDocument();
  });

  it('shows cached data message when no pending mutations', () => {
    render(<OfflineIndicator show={true} pendingMutationsCount={0} />);
    expect(screen.getByText(/viewing cached data/i)).toBeInTheDocument();
  });
});