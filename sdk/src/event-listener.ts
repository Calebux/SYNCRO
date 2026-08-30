/**
 * On-chain event listener for Soroban contract events.
 * Polls RPC getEvents, emits parsed events, and auto-reconnects on disconnect.
 */

import type { Logger } from "./types.js";
import { silentLogger } from "./logger.js";

export interface ContractEvent {
  type: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topics: string[];
  value: Record<string, unknown>;
}

export interface RenewalAttemptEvent {
  subId: string;
  success: boolean;
  owner?: string;
  failureCount?: number;
  ledger: number;
  txHash: string;
  contractId: string;
  schema_version?: number;
}

export interface ApprovalGrantedEvent {
  subId: string;
  approvalId: string;
  maxSpend: string;
  expiresAt: number;
  ledger: number;
  txHash: string;
  contractId: string;
  schema_version?: number;
}

export interface RenewalFailedEvent {
  subId: string;
  failureCount: number;
  ledger: number;
  txHash: string;
  contractId: string;
}

export type OnChainEvent =
  | { type: 'renewalAttempt'; data: RenewalAttemptEvent }
  | { type: 'approvalGranted'; data: ApprovalGrantedEvent }
  | { type: 'renewalFailed'; data: RenewalFailedEvent };

export const CURRENT_EVENT_SCHEMA_VERSION = 1;

export function getEventSchemaVersion(event: ContractEvent): number {
  const rawVersion = (event.value as any)?.schema_version;
  return typeof rawVersion === 'number' ? rawVersion : CURRENT_EVENT_SCHEMA_VERSION;
}

export function isSupportedEventSchemaVersion(event: ContractEvent): boolean {
  const version = getEventSchemaVersion(event);
  const supported = version === CURRENT_EVENT_SCHEMA_VERSION;
  if (!supported) {
    silentLogger.warn('Unsupported contract event schema version', {
      eventType: event.type,
      txHash: event.txHash,
      ledger: event.ledger,
      schemaVersion: version,
      supportedVersion: CURRENT_EVENT_SCHEMA_VERSION,
    });
  }
  return supported;
}

export interface ListenToEventsOptions {
  /** Soroban RPC URL (e.g. https://soroban-testnet.stellar.org) */
  rpcUrl: string;
  /** Contract address(es) to listen to */
  contractIds: string | string[];
  /** Poll interval in ms (default: 5000) */
  pollIntervalMs?: number;
  /** Get last processed ledger (for resuming) */
  getLastLedger?: () => Promise<number>;
  /** Persist last processed ledger */
  setLastLedger?: (ledger: number) => Promise<void>;
  /** Max consecutive failures before reconnect backoff (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnect backoff in ms (default: 1000) */
  reconnectDelayMs?: number;
  /** Optional signal to cancel polling or wait operations */
  signal?: AbortSignal;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 60000;

export async function fetchEvents(
  rpcUrl: string,
  contractIds: string[],
  startLedger: number,
  options?: { signal?: AbortSignal }
): Promise<ContractEvent[]> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options?.signal || null,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params: {
        startLedger,
        filters: contractIds.map((id) => ({ contractIds: [id] })),
      },
    }),
  });

  const data = (await response.json()) as {
    error?: { message?: string };
    result?: { events?: ContractEvent[] };
  };
  if (data.error) {
    throw new Error(data.error.message ?? 'RPC getEvents failed');
  }
  return data.result?.events ?? [];
}

export async function getLatestLedger(
  rpcUrl: string,
  options?: { signal?: AbortSignal }
): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options?.signal || null,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestLedger',
    }),
  });

  const data = (await response.json()) as {
    error?: { message?: string };
    result?: { sequence?: number };
  };
  if (data.error) {
    throw new Error(data.error.message ?? 'RPC getLatestLedger failed');
  }
  return data.result?.sequence ?? 0;
}

function parseEvent(
  event: ContractEvent
): OnChainEvent | null {
  if (!isSupportedEventSchemaVersion(event)) return null;

  const ids = Array.isArray(event.contractId)
    ? event.contractId
    : [event.contractId];
  const contractId = ids[0] ?? '';
  const schemaVersion = getEventSchemaVersion(event);

  switch (event.type) {
    case 'RenewalSuccess': {
      const v = event.value as { sub_id?: string | number; owner?: string; schema_version?: number };
      const attemptEvent: RenewalAttemptEvent = {
        subId: String(v.sub_id ?? ''),
        success: true,
        ledger: event.ledger,
        txHash: event.txHash,
        contractId,
        schema_version: schemaVersion,
      };
      if (v.owner !== undefined) attemptEvent.owner = v.owner;
      return {
        type: 'renewalAttempt',
        data: attemptEvent,
      };
    }
    case 'RenewalFailed': {
      const v = event.value as {
        sub_id?: string | number;
        failure_count?: number;
        ledger?: number;
        schema_version?: number;
      };
      const data: RenewalFailedEvent = {
        subId: String(v.sub_id ?? ''),
        failureCount: v.failure_count ?? 0,
        ledger: event.ledger,
        txHash: event.txHash,
        contractId,
        schema_version: schemaVersion,
      };
      return {
        type: 'renewalFailed',
        data,
      };
    }
    case 'ApprovalCreated': {
      const v = event.value as {
        sub_id?: string | number;
        approval_id?: string | number;
        max_spend?: string | number;
        expires_at?: number;
        schema_version?: number;
      };
      return {
        type: 'approvalGranted',
        data: {
          subId: String(v.sub_id ?? ''),
          approvalId: String(v.approval_id ?? ''),
          maxSpend: String(v.max_spend ?? '0'),
          expiresAt: v.expires_at ?? 0,
          ledger: event.ledger,
          txHash: event.txHash,
          contractId,
          schema_version: schemaVersion,
        },
      };
    }
    default:
      return null;
  }
}

export interface EventListenerController {
  stop: () => void;
}

export function createEventListener(
  options: ListenToEventsOptions,
  onEvent: (event: OnChainEvent) => void,
  onError?: (err: Error) => void
): EventListenerController {
  const contractIds = Array.isArray(options.contractIds)
    ? options.contractIds
    : [options.contractIds];
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectAttempts =
    options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  const logger = options.logger ?? silentLogger;

  let isRunning = true;
  let lastProcessedLedger = 0;
  let consecutiveFailures = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  logger.info("Event listener starting", {
    contractIds: contractIds.length,
    rpcUrl: options.rpcUrl,
  });

  const stop = () => {
    isRunning = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (options.signal) {
      options.signal.removeEventListener('abort', stop);
    }
  };

  if (options.signal) {
    options.signal.addEventListener('abort', stop);
    if (options.signal.aborted) {
      stop();
      return { stop };
    }
  }

  const poll = async () => {
    if (!isRunning) return;

    try {
      if (lastProcessedLedger === 0 && options.getLastLedger) {
        lastProcessedLedger = await options.getLastLedger();
      }

      const currentLedger = await getLatestLedger(options.rpcUrl, options.signal ? { signal: options.signal } : undefined);
      if (currentLedger < lastProcessedLedger) {
        lastProcessedLedger = Math.max(0, currentLedger - 1);
      }

      const fromLedger = lastProcessedLedger + 1;
      const events = await fetchEvents(
        options.rpcUrl,
        contractIds,
        fromLedger,
        options.signal ? { signal: options.signal } : undefined
      );

      consecutiveFailures = 0;

      if (events.length > 0) {
        const maxLedger = Math.max(...events.map((e) => e.ledger));

        logger.debug("Events received", { count: events.length, fromLedger, toLedger: maxLedger });

        for (const raw of events) {
          const parsed = parseEvent(raw);
          if (parsed) onEvent(parsed);
        }

        lastProcessedLedger = maxLedger;
        if (options.setLastLedger) {
          await options.setLastLedger(lastProcessedLedger);
        }
      }
    } catch (err) {
      consecutiveFailures++;
      const error = err instanceof Error ? err : new Error(String(err));
      
      logger.warn("Event listener poll failed", {
        attempt: consecutiveFailures,
        maxAttempts: maxReconnectAttempts,
        error: error.message,
      });
      
      onError?.(error);

      const backoff = Math.min(
        reconnectDelayMs * Math.pow(2, consecutiveFailures - 1),
        MAX_BACKOFF_MS
      );
      
      if (consecutiveFailures >= maxReconnectAttempts) {
        logger.warn("Max reconnection attempts reached, applying backoff", {
          backoffMs: backoff,
        });
        setTimeout(poll, backoff);
      } else {
        setTimeout(poll, pollIntervalMs);
      }
      return;
    }

    if (isRunning) {
      timeoutId = setTimeout(poll, pollIntervalMs);
    }
  };

  poll();

  return { stop };
}
