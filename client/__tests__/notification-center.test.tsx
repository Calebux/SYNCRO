import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import {
  type V3NotificationDispatchRecord,
  loadNotificationCenterPreferences,
  publishV3NotificationEvent,
  resetNotificationCenterStorage,
} from '@/lib/notifications/v3-notification-center';

describe('Issue #1865: Notification center for cap, dispute, and payout events', () => {
  beforeEach(() => {
    resetNotificationCenterStorage();
  });

  it('renders seeded v3 events with unread counts, marks disputes as urgent, and links each to its action', () => {
    render(<NotificationCenter />);

    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('4 unread');
    expect(screen.getByTestId('notification-urgent-count')).toHaveTextContent('1 urgent');

    // Dispute event is marked urgent and links to its dispute action
    const disputeItem = screen.getByTestId('notification-item-seed_notif_dispute_1');
    expect(disputeItem).toHaveTextContent('Urgent');
    expect(disputeItem).toHaveTextContent('Channel dispute opened on v3-ch-demo');

    const disputeAction = screen.getByTestId('notification-action-seed_notif_dispute_1');
    expect(disputeAction).toHaveAttribute(
      'href',
      '/settings/privacy/channels?channelId=v3-ch-demo&action=respond-dispute',
    );
    expect(disputeAction).toHaveTextContent('Respond to dispute');

    // Cap warning event links to its cap adjustment action
    const capAction = screen.getByTestId('notification-action-seed_notif_cap_1');
    expect(capAction).toHaveAttribute('href', '/agents?agentId=v3-agent-demo&action=adjust-cap');

    // Payout sent event links to its payout action
    const payoutAction = screen.getByTestId('notification-action-seed_notif_payout_1');
    expect(payoutAction).toHaveAttribute(
      'href',
      '/provider?settlementId=stl_prov_003&action=view-payout',
    );

    // Agent revoked event links to its revocation review action
    const revokedAction = screen.getByTestId('notification-action-seed_notif_revoked_1');
    expect(revokedAction).toHaveAttribute(
      'href',
      '/agents?agentId=v3-agent-research&action=review-revocation',
    );
  });

  it('streams seeded and live events into the feed in real time (#1507)', () => {
    render(<NotificationCenter autoSeedOnMount={false} />);

    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('0 unread');
    expect(screen.getByTestId('notification-feed-empty')).toBeInTheDocument();

    act(() => {
      publishV3NotificationEvent({
        id: 'rt_dispute_99',
        eventType: 'dispute_detected',
        title: 'Real-time watchtower dispute on channel ch_live_99',
        message: 'Counterparty attempted unilateral close with stale sequence #7.',
        metadata: { channelId: 'ch_live_99' },
      });
    });

    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('1 unread');
    expect(screen.getByTestId('notification-urgent-count')).toHaveTextContent('1 urgent');
    expect(screen.getByTestId('notification-item-rt_dispute_99')).toHaveTextContent(
      'Real-time watchtower dispute on channel ch_live_99',
    );
    expect(screen.getByTestId('notification-action-rt_dispute_99')).toHaveAttribute(
      'href',
      '/settings/privacy/channels?channelId=ch_live_99&action=respond-dispute',
    );

    // Also stream all seeded events via the button
    fireEvent.click(screen.getByTestId('seed-realtime-events'));
    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('5 unread');
  });

  it('saves and respects per-event-type delivery preferences (in_app, email, webhook)', () => {
    const dispatched: V3NotificationDispatchRecord[] = [];
    const onPreferencesSaved = vi.fn();

    render(
      <NotificationCenter
        autoSeedOnMount={false}
        onPreferencesSaved={onPreferencesSaved}
        onEventDispatched={(rec) => dispatched.push(rec)}
      />,
    );

    // Disable in-app and enable webhook for cap_warning
    const capInAppCheckbox = screen.getByTestId('pref-cap_warning-in_app') as HTMLInputElement;
    const capWebhookCheckbox = screen.getByTestId('pref-cap_warning-webhook') as HTMLInputElement;
    expect(capInAppCheckbox.checked).toBe(true);
    expect(capWebhookCheckbox.checked).toBe(false);

    fireEvent.click(capInAppCheckbox);
    fireEvent.click(capWebhookCheckbox);

    expect(onPreferencesSaved).toHaveBeenCalledTimes(2);
    const saved = loadNotificationCenterPreferences();
    expect(saved.cap_warning).toEqual({
      in_app: false,
      email: true,
      webhook: true,
    });

    // Emit a cap_warning event in real time: because in_app is false, it must NOT
    // appear in the in-app feed, while still routing to email + webhook!
    act(() => {
      publishV3NotificationEvent({
        id: 'rt_cap_muted_in_app',
        eventType: 'cap_warning',
        title: 'Agent cap at 85%',
        message: 'Cap threshold crossed.',
      });
    });

    expect(screen.queryByTestId('notification-item-rt_cap_muted_in_app')).toBeNull();
    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('0 unread');
    expect(dispatched[0]?.routedChannels).toEqual(['email', 'webhook']);
    expect(dispatched[0]?.deliveredInApp).toBe(false);
    expect(dispatched[0]?.deliveredEmail).toBe(true);
    expect(dispatched[0]?.deliveredWebhook).toBe(true);
  });

  it('updates unread count when marking single or all notifications as read', () => {
    render(<NotificationCenter />);

    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('4 unread');

    fireEvent.click(screen.getByTestId('mark-read-seed_notif_dispute_1'));
    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('3 unread');
    expect(screen.queryByTestId('notification-urgent-count')).toBeNull();

    fireEvent.click(screen.getByTestId('mark-all-read'));
    expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('0 unread');
  });
});
