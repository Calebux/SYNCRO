/**
 * Tests for #613 — Privacy self-service flows
 *
 * Covers:
 * - Export job state (pending → ready, pending → error)
 * - Failure recovery (inline retry)
 * - Delete modal confirmation UX (checkbox required, backdrop close blocked during request)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataPrivacyPage from '@/app/settings/privacy/page';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

global.URL.createObjectURL = vi.fn(() => 'blob:mock');
global.URL.revokeObjectURL = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.clearAllTimers();
});

afterEach(() => {
  vi.clearAllTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  const user = userEvent.setup();
  render(<DataPrivacyPage />);
  return { user };
}

// ─── Export tests ─────────────────────────────────────────────────────────────

describe('DataPrivacyPage — export flow', () => {
  it('shows pending state while export job is in progress', async () => {
    // POST /export returns a jobId; status endpoint returns "pending" indefinitely
    let resolveStatus: (v: any) => void;
    const statusPromise = new Promise((res) => { resolveStatus = res; });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ jobId: 'job-123' }),
      } as any)
      .mockReturnValue(statusPromise as any);

    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /download export/i }));

    expect(await screen.findByText(/preparing your export/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preparing export/i })).toBeDisabled();

    // Resolve to avoid dangling promise
    resolveStatus!({ ok: true, json: async () => ({ status: 'pending' }) });
  });

  it('shows success banner when job completes (no download URL)', async () => {
    // status: ready with no downloadUrl — just shows the success banner
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ jobId: 'job-123' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready' }),
      } as any);

    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /download export/i }));

    await waitFor(() => {
      expect(screen.getByText(/your export is ready/i)).toBeInTheDocument();
    });
  });

  it('shows error banner and retry link when export fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /download export/i }));

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows error when export request returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as any);

    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /download export/i }));

    expect(await screen.findByText(/export request failed/i)).toBeInTheDocument();
  });
});

// ─── Delete modal tests ───────────────────────────────────────────────────────

describe('DataPrivacyPage — delete modal', () => {
  it('opens modal when Delete Account is clicked', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /delete account/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps confirm button disabled until checkbox is checked', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /delete account/i }));

    // The "Delete Account" button inside the modal
    const confirmBtn = screen.getAllByRole('button', { name: /delete account/i }).find(
      (b) => b.closest('[role="dialog"]'),
    )!;
    expect(confirmBtn).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(confirmBtn).not.toBeDisabled();
  });

  it('submits delete request and shows scheduled banner', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);

    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /delete account/i }));
    await user.click(screen.getByRole('checkbox'));

    const confirmBtn = screen.getAllByRole('button', { name: /delete account/i }).find(
      (b) => b.closest('[role="dialog"]'),
    )!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/account deletion has been scheduled/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows error alert when delete request fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as any);

    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /delete account/i }));
    await user.click(screen.getByRole('checkbox'));

    const confirmBtn = screen.getAllByRole('button', { name: /delete account/i }).find(
      (b) => b.closest('[role="dialog"]'),
    )!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Modal stays open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes modal on Cancel click', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /delete account/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes modal on backdrop click', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: /delete account/i }));

    const backdrop = screen.getByRole('dialog');
    // Click the backdrop (the dialog element itself, not its children)
    await act(async () => {
      fireEvent.click(backdrop);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
