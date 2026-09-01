import logger from '../config/logger';
import { supabase } from '../config/database';
import { env } from '../config/env';
import { reorgHandler } from './reorg-handler';
import { generateCycleId } from '../utils/cycle-id';
import { renewalCooldownService } from './renewal-cooldown-service';
import { calculateBackoffDelay } from '../utils/retry';
import { RpcClient } from '@syncro/shared/rpc-client';
import {
  getBlockchainFlags,
  resolveStellarNetwork,
} from '../../../shared/blockchain-flags';

import { 
  ContractEvent, 
  ProcessedEvent, 
  EventType,
  RenewalSuccessPayload,
  RenewalFailedPayload,
  StateTransitionPayload,
  ApprovalCreatedPayload,
  ApprovalRejectedPayload,
  ExecutorAssignedPayload,
  DuplicateRenewalRejectedPayload,
  LifecycleTimestampUpdatedPayload,
  ContractEventValue,
  CURRENT_CONTRACT_EVENT_SCHEMA_VERSION,
} from '../types/contract-events';
import { rpcEventResponseSchema } from '../schemas/contract-events';
import { Subscription } from '../types/subscription';

export type EventListenerStatus = 'running' | 'stopped' | 'disabled' | 'retrying' | 'failed';

const SUPPORTED_CONTRACT_EVENT_SCHEMA_VERSIONS = [CURRENT_CONTRACT_EVENT_SCHEMA_VERSION] as const;
/** See job-alert-config.ts `event-listener` thresholds (default: 10 consecutive failures). */
const ALERT_THRESHOLD = 10;
const MAX_BACKOFF_MS = 300_000; // 5 minutes
const MAX_RETRY_ATTEMPTS = 10;
const RETRY_INITIAL_DELAY_MS = 5000;
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export class EventListener {
  private contractId: string;
  private rpcUrl: string = '';
  private lastProcessedLedger: number = 0;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;

  // Configurable via env var — defaults to 5 seconds
  private readonly pollInterval: number = parseInt(
    env.EVENT_LISTENER_INTERVAL_MS,
    10
  );

  // Resilience & Health state
  private consecutiveErrors: number = 0;
  private lastSuccessfulPoll: Date | null = null;
  private _status: EventListenerStatus = 'stopped';
  private _disabledReason?: string;
  private _retryCount: number = 0;
  private _nextRetryAt: Date | null = null;
  private activeRequestController: AbortController | null = null;
  private rpcClient: RpcClient;

  constructor() {
    this.contractId = env.SOROBAN_CONTRACT_ADDRESS || '';

    const flags = getBlockchainFlags();
    const network = resolveStellarNetwork();

    // Resolve RPC URL — never silently fall back to testnet in production.
    const configuredUrl = env.STELLAR_NETWORK_URL;
    if (!configuredUrl && flags.isProduction) {
      this._status = 'disabled';
      this._disabledReason =
        'STELLAR_NETWORK_URL must be explicitly set in production. ' +
        'Refusing to fall back to the testnet RPC endpoint.';
      logger.error(`EventListener disabled: ${this._disabledReason}`);
    } else {
      this.rpcUrl =
        configuredUrl ||
        (network === 'mainnet'
          ? 'https://soroban-rpc.creit.tech'
          : network === 'futurenet'
            ? 'https://rpc-futurenet.stellar.org'
            : 'https://soroban-testnet.stellar.org');
    }

    this.rpcClient = new RpcClient({
      timeoutMs: 15000,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
    });

    if (!this.contractId) {
      this._status = 'disabled';
      this._disabledReason = 'SOROBAN_CONTRACT_ADDRESS not configured';
      logger.warn('EventListener disabled: SOROBAN_CONTRACT_ADDRESS not configured');
    }

    if (!flags.blockchainEnabled) {
      this._status = 'disabled';
      this._disabledReason = 'ENABLE_BLOCKCHAIN=false — event listener is disabled';
      logger.warn(`EventListener disabled: ${this._disabledReason}`);
    }
  }

  getHealth(): EventListenerHealth {
    return {
      status: this._status,
      isRunning: this.isRunning,
      lastSuccessfulPoll: this.lastSuccessfulPoll?.toISOString() ?? null,
      consecutiveErrors: this.consecutiveErrors,
      lastProcessedLedger: this.lastProcessedLedger || null,
      reason: this._disabledReason,
      retryCount: this._retryCount,
      nextRetryAt: this._nextRetryAt?.toISOString() ?? null,
    };
  }

  async start() {
    if (this._status === 'disabled') {
      logger.warn('EventListener.start() called but listener is disabled', {
        reason: this._disabledReason,
      });
      return;
    }

    if (this.isRunning) return;

    this.isRunning = true;
    this._status = 'running';
    this._retryCount = 0;
    this._nextRetryAt = null;
    this.lastProcessedLedger = await this.getLastProcessedLedger();
    logger.info('Event listener started', { lastLedger: this.lastProcessedLedger });

    void this.poll();
  }

  stop() {
    this.isRunning = false;
    this.abortActiveRequest();
    if (this._status !== 'disabled') {
      this._status = 'stopped';
    }
    logger.info('Event listener stopped');
  }

  private async poll() {
    let backoffMs = this.pollInterval;

    while (this.isRunning) {
      if (this.isProcessing) {
        logger.warn('EventListener: previous poll still running, skipping tick');
        await this.sleep(backoffMs);
        continue;
      }

      this.isProcessing = true;
      try {
        await this.fetchAndProcessEvents();

        // Success — reset backoff and error counter
        this.lastSuccessfulPoll = new Date();
        this.consecutiveErrors = 0;
        backoffMs = this.pollInterval;
        
        if (this._retryCount > 0) {
          logger.info('EventListener recovered after retries', { retryCount: this._retryCount });
          this._retryCount = 0;
          this._nextRetryAt = null;
          this._status = 'running';
        }
      } catch (error) {
        this.consecutiveErrors++;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);

        logger.error('EventListener poll failed', {
          error,
          consecutiveErrors: this.consecutiveErrors,
          nextRetryMs: backoffMs,
        });

        if (this.consecutiveErrors === ALERT_THRESHOLD) {
          logger.error(`ALERT: EventListener has failed ${ALERT_THRESHOLD} consecutive times`, {
            lastSuccessfulPoll: this.lastSuccessfulPoll?.toISOString() ?? 'never',
          });
        }

        await this.handlePollError(error);
        if (!this.isRunning) break;
      } finally {
        this.isProcessing = false;
      }

      await this.sleep(backoffMs);
    }
  }

  private async handlePollError(error: unknown) {
    this._retryCount++;

    if (this._retryCount >= MAX_RETRY_ATTEMPTS) {
      this._status = 'failed';
      this._disabledReason = `Exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}). Last error: ${error instanceof Error ? error.message : String(error)}`;
      logger.error('EventListener permanently failed after max retries', {
        retryCount: this._retryCount,
        error: this._disabledReason,
      });
      this.isRunning = false;
      return;
    }

    const delay = calculateBackoffDelay(this._retryCount, {
      initialDelay: RETRY_INITIAL_DELAY_MS,
      maxDelay: RETRY_MAX_DELAY_MS,
      multiplier: 2,
      jitter: true,
    });

    this._status = 'retrying';
    this._nextRetryAt = new Date(Date.now() + delay);
    logger.warn('EventListener will retry', {
      attempt: this._retryCount,
      delayMs: delay,
      nextRetryAt: this._nextRetryAt.toISOString(),
    });

    await this.sleep(delay);
  }

  private async fetchAndProcessEvents() {
    const currentLedger = await this.getCurrentLedger();

    // Check for reorg
    if (currentLedger < this.lastProcessedLedger) {
      await reorgHandler.handleReorg(currentLedger, this.lastProcessedLedger);
      this.lastProcessedLedger = await this.getLastProcessedLedger();
    }

    const events = await this.fetchEvents(this.lastProcessedLedger + 1);

    if (events.length === 0) return;

    const processed = await this.processEvents(events);

    if (processed.length > 0) {
      await this.saveEvents(processed);
    }
    
    this.lastProcessedLedger = Math.max(...events.map(e => e.ledger));
    await this.updateLastProcessedLedger(this.lastProcessedLedger);
  }

  private async fetchEvents(fromLedger: number): Promise<ContractEvent[]> {
    const requestController = this.beginRequest();
    try {
      const response = await this.rpcClient.fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getEvents',
          params: {
            startLedger: fromLedger,
            filters: [{ contractIds: [this.contractId] }],
          },
        }),
        signal: requestController.signal,
      });

      const data = await response.json();
      const parsed = rpcEventResponseSchema.safeParse(data);
      
      if (!parsed.success) {
        logger.error('RPC event response validation failed', { 
          error: parsed.error.format(),
          raw: data 
        });
        return [];
      }

      return parsed.data.result?.events || [];
    } finally {
      this.endRequest(requestController);
    }
  }

  private getEventSchemaVersion(event: ContractEvent): number {
    const rawVersion = (event.value as any)?.schema_version;
    return typeof rawVersion === 'number'
      ? rawVersion
      : CURRENT_CONTRACT_EVENT_SCHEMA_VERSION;
  }

  private isSupportedSchemaVersion(event: ContractEvent): boolean {
    const version = this.getEventSchemaVersion(event);
    const supported = SUPPORTED_CONTRACT_EVENT_SCHEMA_VERSIONS.includes(version as typeof SUPPORTED_CONTRACT_EVENT_SCHEMA_VERSIONS[number]);

    if (!supported) {
      logger.warn('Unsupported contract event schema version', {
        eventType: event.type,
        txHash: event.txHash,
        ledger: event.ledger,
        schemaVersion: version,
        supportedVersions: SUPPORTED_CONTRACT_EVENT_SCHEMA_VERSIONS,
      });
    }

    return supported;
  }

  private async processEvents(events: ContractEvent[]): Promise<ProcessedEvent[]> {
    const processed: ProcessedEvent[] = [];

    for (const event of events) {
      if (!this.isSupportedSchemaVersion(event)) continue;

      const handler = this.getEventHandler(event.type);
      if (handler) {
        const result = await handler(event);
        if (result) processed.push(result);
      }
    }

    return processed;
  }

  private getEventHandler(eventType: string) {
    const handlers: Record<string, (e: ContractEvent) => Promise<ProcessedEvent | null>> = {
      [EventType.RENEWAL_SUCCESS]: this.handleRenewalSuccess.bind(this),
      [EventType.RENEWAL_FAILED]: this.handleRenewalFailed.bind(this),
      [EventType.STATE_TRANSITION]: this.handleStateTransition.bind(this),
      [EventType.APPROVAL_CREATED]: this.handleApprovalCreated.bind(this),
      [EventType.APPROVAL_REJECTED]: this.handleApprovalRejected.bind(this),
      [EventType.EXECUTOR_ASSIGNED]: this.handleExecutorAssigned.bind(this),
      [EventType.EXECUTOR_REMOVED]: this.handleExecutorRemoved.bind(this),
      [EventType.DUPLICATE_RENEWAL_REJECTED]: this.handleDuplicateRenewalRejected.bind(this),
      [EventType.LIFECYCLE_TIMESTAMP_UPDATED]: this.handleLifecycleTimestampUpdated.bind(this),
    };

    return handlers[eventType];
  }

  private async handleRenewalSuccess(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id } = event.value as RenewalSuccessPayload;

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, next_billing_date')
      .eq('blockchain_sub_id', sub_id)
      .single();

    const updateData: Partial<Subscription> = {
      status: 'active',
      last_interaction_at: new Date().toISOString(),
      failure_count: 0,
      last_renewal_attempt_at: new Date().toISOString(),
    };

    if (sub?.next_billing_date) {
      updateData.last_renewal_cycle_id = generateCycleId(sub.next_billing_date);
    }

    await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('blockchain_sub_id', sub_id);

    if (sub?.id) {
      try {
        await renewalCooldownService.recordRenewalAttempt(sub.id, true, undefined, 'automatic');
      } catch (recordError) {
        logger.warn('Failed to record renewal attempt success:', recordError);
      }
    }

    return {
      sub_id,
      event_type: 'renewal_success',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleRenewalFailed(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, failure_count } = event.value as RenewalFailedPayload;

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('blockchain_sub_id', sub_id)
      .single();

    const updateData: Partial<Subscription> = {
      status: 'retrying',
      failure_count,
      last_renewal_attempt_at: new Date().toISOString(),
    };

    await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('blockchain_sub_id', sub_id);

    if (sub?.id) {
      try {
        await renewalCooldownService.recordRenewalAttempt(
          sub.id,
          false,
          `Renewal failed on blockchain (failure count: ${failure_count})`,
          'automatic'
        );
      } catch (recordError) {
        logger.warn('Failed to record renewal attempt failure:', recordError);
      }
    }

    return {
      sub_id,
      event_type: 'renewal_failed',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleStateTransition(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, new_state } = event.value as StateTransitionPayload;

    const statusMap: Record<string, string> = {
      Active: 'active',
      Retrying: 'retrying',
      Failed: 'cancelled',
    };

    await supabase
      .from('subscriptions')
      .update({ status: statusMap[new_state] || 'active' })
      .eq('blockchain_sub_id', sub_id);

    return {
      sub_id,
      event_type: 'state_transition',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleApprovalCreated(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, approval_id, max_spend, expires_at } = event.value as ApprovalCreatedPayload;

    await supabase
      .from('renewal_approvals')
      .insert({
        blockchain_sub_id: sub_id,
        approval_id,
        max_spend,
        expires_at,
        used: false,
      });

    return {
      sub_id,
      event_type: 'approval_created',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleApprovalRejected(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, approval_id, reason } = event.value as ApprovalRejectedPayload;

    await supabase
      .from('renewal_approvals')
      .update({
        rejected: true,
        rejection_reason: reason,
      })
      .eq('blockchain_sub_id', sub_id)
      .eq('approval_id', approval_id);

    return {
      sub_id,
      event_type: 'approval_rejected',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleExecutorAssigned(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, executor } = event.value as ExecutorAssignedPayload;

    await supabase
      .from('subscriptions')
      .update({ executor_address: executor })
      .eq('blockchain_sub_id', sub_id);

    return {
      sub_id,
      event_type: 'executor_assigned',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleExecutorRemoved(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id } = event.value as { sub_id: number };

    await supabase
      .from('subscriptions')
      .update({ executor_address: null })
      .eq('blockchain_sub_id', sub_id);

    return {
      sub_id,
      event_type: 'executor_removed',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleDuplicateRenewalRejected(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, cycle_id } = event.value as DuplicateRenewalRejectedPayload;
    logger.warn('Duplicate renewal rejected', { sub_id, cycle_id, ledger: event.ledger });

    return {
      sub_id,
      event_type: 'duplicate_renewal_rejected',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async handleLifecycleTimestampUpdated(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, event_kind, timestamp } = event.value as LifecycleTimestampUpdatedPayload;

    const column = LIFECYCLE_COLUMN_MAP[event_kind as number];
    if (!column) {
      logger.warn('Unknown lifecycle event_kind', { sub_id, event_kind });
      return null;
    }

    const { error } = await supabase
      .from('subscriptions')
      .update({ [column]: timestamp })
      .eq('blockchain_sub_id', sub_id);

    if (error) {
      logger.error('Failed to update lifecycle timestamp', { error, sub_id, column });
    }

    return {
      sub_id,
      event_type: 'lifecycle_timestamp_updated',
      ledger: event.ledger,
      tx_hash: event.txHash,
      event_data: event.value,
    };
  }

  private async saveEvents(events: ProcessedEvent[]) {
    const { error } = await supabase
      .from('contract_events')
      .insert(
        events.map(e => ({
          ...e,
          processed_at: new Date().toISOString(),
        }))
      );

    if (error) {
      logger.error('Failed to save events:', error);
      throw error;
    }

    logger.info('Saved events', { count: events.length });
  }

  private async getLastProcessedLedger(): Promise<number> {
    const { data } = await supabase
      .from('event_cursor')
      .select('last_ledger')
      .single();

    return data?.last_ledger || 0;
  }

  private async updateLastProcessedLedger(ledger: number) {
    await supabase
      .from('event_cursor')
      .upsert({ id: 1, last_ledger: ledger } as any);
  }

  private async getCurrentLedger(): Promise<number> {
    const requestController = this.beginRequest();
    try {
      const response = await this.rpcClient.fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestLedger',
        }),
        signal: requestController.signal,
      });

      const data = await response.json();
      return (data as any).result?.sequence || 0;
    } finally {
      this.endRequest(requestController);
    }
  }

  private beginRequest(): AbortController {
    const controller = new AbortController();
    this.activeRequestController = controller;
    return controller;
  }

  private endRequest(controller: AbortController): void {
    if (this.activeRequestController === controller) {
      this.activeRequestController = null;
    }
  }

  private abortActiveRequest(): void {
    if (!this.activeRequestController) return;
    this.activeRequestController.abort();
    this.activeRequestController = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const LIFECYCLE_COLUMN_MAP: Record<number, string> = {
  1: 'blockchain_created_at',
  2: 'blockchain_activated_at',
  3: 'blockchain_last_renewed_at',
  4: 'blockchain_canceled_at',
};

export const eventListener = new EventListener();
