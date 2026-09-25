export type V3NotificationEventType =
  | 'cap_threshold_warning'
  | 'channel_nearing_exhaustion'
  | 'channel_close_initiated'
  | 'dispute_detected'
  | 'degraded_mode_entered'
  | 'degraded_mode_exited'
  | 'reconciliation_delta_outside_tolerance';

export type AudienceClassification = 'principal' | 'operator';

export type NotificationChannel = 'push' | 'telegram' | 'slack';

export interface V3EventClassification {
  eventType: V3NotificationEventType;
  audience: AudienceClassification;
  severity: 'info' | 'warning' | 'critical';
  description: string;
}

export const V3_EVENT_CLASSIFICATIONS: Record<V3NotificationEventType, V3EventClassification> = {
  cap_threshold_warning: {
    eventType: 'cap_threshold_warning',
    audience: 'principal',
    severity: 'warning',
    description: 'Spending cap or budget threshold is approaching or has been crossed.',
  },
  channel_nearing_exhaustion: {
    eventType: 'channel_nearing_exhaustion',
    audience: 'principal',
    severity: 'warning',
    description: 'Payment channel balance is low and covers fewer than 2 renewal cycles.',
  },
  channel_close_initiated: {
    eventType: 'channel_close_initiated',
    audience: 'principal',
    severity: 'warning',
    description: 'A payment channel close has been initiated — either cooperative or unilateral.',
  },
  dispute_detected: {
    eventType: 'dispute_detected',
    audience: 'operator',
    severity: 'critical',
    description: 'A payment channel entered dispute state — watchtower or counterparty intervention required.',
  },
  degraded_mode_entered: {
    eventType: 'degraded_mode_entered',
    audience: 'operator',
    severity: 'warning',
    description: 'One or more critical dependencies entered degraded mode — system running with reduced functionality.',
  },
  degraded_mode_exited: {
    eventType: 'degraded_mode_exited',
    audience: 'operator',
    severity: 'info',
    description: 'All critical dependencies returned to healthy state — system exited degraded mode.',
  },
  reconciliation_delta_outside_tolerance: {
    eventType: 'reconciliation_delta_outside_tolerance',
    audience: 'operator',
    severity: 'critical',
    description: 'Blockchain reconciliation detected mismatches between on-chain events and backend records exceeding tolerance.',
  },
};

export type V3NotificationPreferences = Record<V3NotificationEventType, {
  enabled: boolean;
  channels: NotificationChannel[];
}>;

export const DEFAULT_V3_PRINCIPAL_PREFERENCES: V3NotificationPreferences = {
  cap_threshold_warning: { enabled: true, channels: ['push'] },
  channel_nearing_exhaustion: { enabled: true, channels: ['push', 'telegram'] },
  channel_close_initiated: { enabled: true, channels: ['push', 'telegram'] },
  dispute_detected: { enabled: false, channels: [] },
  degraded_mode_entered: { enabled: false, channels: [] },
  degraded_mode_exited: { enabled: false, channels: [] },
  reconciliation_delta_outside_tolerance: { enabled: false, channels: [] },
};

export const DEFAULT_V3_OPERATOR_PREFERENCES: V3NotificationPreferences = {
  cap_threshold_warning: { enabled: false, channels: [] },
  channel_nearing_exhaustion: { enabled: false, channels: [] },
  channel_close_initiated: { enabled: false, channels: [] },
  dispute_detected: { enabled: true, channels: ['slack'] },
  degraded_mode_entered: { enabled: true, channels: ['slack'] },
  degraded_mode_exited: { enabled: true, channels: ['slack'] },
  reconciliation_delta_outside_tolerance: { enabled: true, channels: ['slack'] },
};

export interface CapThresholdWarningPayload {
  userId: string;
  subscriptionId?: string;
  currentSpend: number;
  budgetAmount: number;
  percentageUsed: number;
  currency: string;
  threshold: number;
  exceeded: boolean;
}

export interface ChannelNearingExhaustionPayload {
  userId: string;
  channelId: string;
  currentBalance: number;
  averageRenewalAmount: number;
  renewalsRemaining: number;
  currency: string;
  autoTopUpEnabled: boolean;
}

export interface ChannelCloseInitiatedPayload {
  userId: string;
  channelId: string;
  unilateral: boolean;
  disputeWindowDays: number;
  remainingBalance: number;
  currency: string;
}

export interface DisputeDetectedPayload {
  channelId: string;
  userId: string;
  sequenceNumber: number;
  cause: 'unilateral_close' | 'watchtower_challenge' | 'state_mismatch';
  currentBalance: number;
  currency: string;
}

export interface DegradedModePayload {
  timestamp: string;
  dependencies: Array<{
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    error?: string;
  }>;
  previousState: 'healthy' | 'degraded';
  newState: 'healthy' | 'degraded';
}

export interface ReconciliationDeltaPayload {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalMismatches: number;
  mismatchesByType: {
    missing_from_history: number;
    orphan_event: number;
    hash_mismatch: number;
  };
  totalContractEvents: number;
  totalRenewalRecords: number;
  matched: number;
  tolerance: number;
}

export type V3EventPayload =
  | CapThresholdWarningPayload
  | ChannelNearingExhaustionPayload
  | ChannelCloseInitiatedPayload
  | DisputeDetectedPayload
  | DegradedModePayload
  | ReconciliationDeltaPayload;

export interface V3NotificationDispatchInput {
  eventType: V3NotificationEventType;
  targetUserId?: string;
  payload: V3EventPayload;
  url?: string;
}

export interface RenderedV3Notification {
  title: string;
  body: string;
  html?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  url?: string;
}
