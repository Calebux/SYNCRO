import logger from '../config/logger';
import { supabase } from '../config/database';
import { reorgHandler } from './reorg-handler';
import { generateCycleId } from '../utils/cycle-id';
import { renewalCooldownService } from './renewal-cooldown-service';

interface ContractEvent {
  type: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topics: string[];
  value: any;
}

interface ProcessedEvent {
  sub_id: number;
  event_type: string;
  ledger: number;
  tx_hash: string;
  event_data: any;
}

export class EventListener {
  private contractId: string;
  private rpcUrl: string;
  private lastProcessedLedger: number = 0;
  private isRunning: boolean = false;
  private pollInterval: number = 5000;

  constructor() {
    this.contractId = process.env.SOROBAN_CONTRACT_ADDRESS || '';
    this.rpcUrl = process.env.STELLAR_NETWORK_URL || 'https://soroban-testnet.stellar.org';

    if (!this.contractId) {
      throw new Error('SOROBAN_CONTRACT_ADDRESS not configured');
    }
  }

  async start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastProcessedLedger = await this.getLastProcessedLedger();
    logger.info('Event listener started', { lastLedger: this.lastProcessedLedger });

    this.poll();
  }

  stop() {
    this.isRunning = false;
    logger.info('Event listener stopped');
  }

  private async poll() {
    while (this.isRunning) {
      try {
        await this.fetchAndProcessEvents();
      } catch (error) {
        logger.error('Event polling error:', error);
      }
      await this.sleep(this.pollInterval);
    }
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
      this.lastProcessedLedger = Math.max(...events.map(e => e.ledger));
      await this.updateLastProcessedLedger(this.lastProcessedLedger);
    }
  }

  private async fetchEvents(fromLedger: number): Promise<ContractEvent[]> {
    const response = await fetch(this.rpcUrl, {
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
    });

    const data: any = await response.json();
    return data.result?.events || [];
  }

  private async processEvents(events: ContractEvent[]): Promise<ProcessedEvent[]> {
    const processed: ProcessedEvent[] = [];

    for (const event of events) {
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
      RenewalSuccess: this.handleRenewalSuccess.bind(this),
      RenewalFailed: this.handleRenewalFailed.bind(this),
      StateTransition: this.handleStateTransition.bind(this),
      ApprovalCreated: this.handleApprovalCreated.bind(this),
      ApprovalRejected: this.handleApprovalRejected.bind(this),
      ExecutorAssigned: this.handleExecutorAssigned.bind(this),
      ExecutorRemoved: this.handleExecutorRemoved.bind(this),
      DuplicateRenewalRejected: this.handleDuplicateRenewalRejected.bind(this),
      LifecycleTimestampUpdated: this.handleLifecycleTimestampUpdated.bind(this),
    };

    return handlers[eventType];
  }

  private async handleRenewalSuccess(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id } = event.value;

    // Fetch the subscription to get next_billing_date for cycle_id
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, next_billing_date')
      .eq('blockchain_sub_id', sub_id)
      .single();

    const updateData: Record<string, any> = {
      status: 'active',
      last_payment_date: new Date().toISOString(),
      failure_count: 0,
      last_renewal_attempt_at: new Date().toISOString(), // Record successful renewal attempt
    };

    if (sub?.next_billing_date) {
      updateData.last_renewal_cycle_id = generateCycleId(sub.next_billing_date);
    }

    await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('blockchain_sub_id', sub_id);

    // Record the renewal attempt in the tracking table
    if (sub?.id) {
      try {
        await renewalCooldownService.recordRenewalAttempt(
          sub.id,
          true,
          undefined,
          'automatic'
        );
      } catch (recordError) {
        logger.warn('Failed to record renewal attempt success:', recordError);
        // Don't throw - the main operation succeeded
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
    const { sub_id, failure_count } = event.value;

    // Fetch subscription ID for cooldown tracking
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('blockchain_sub_id', sub_id)
      .single();

    const updateData: Record<string, any> = {
      status: 'retrying',
      failure_count,
      last_renewal_attempt_at: new Date().toISOString(), // Record failed renewal attempt
    };

    await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('blockchain_sub_id', sub_id);

    // Record the renewal attempt in the tracking table
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
        // Don't throw - the main operation succeeded
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
    const { sub_id, new_state } = event.value;

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
    const { sub_id, approval_id, max_spend, expires_at } = event.value;

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
    const { sub_id, approval_id, reason } = event.value;

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
    const { sub_id, executor } = event.value;
    
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
    const { sub_id } = event.value;
    
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

  // Duplicate handlers removed below in favor of consolidated implementations later in the file

  private async saveEvents(events: ProcessedEvent[]) {
    const { error } = await supabase
      .from('contract_events')
      .insert(events.map(e => ({
        ...e,
        processed_at: new Date().toISOString(),
      })));

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
      .upsert({ id: 1, last_ledger: ledger });
  }

  private async getCurrentLedger(): Promise<number> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestLedger',
      }),
    });

    const data: any = await response.json();
    return data.result?.sequence || 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async handleDuplicateRenewalRejected(event: ContractEvent): Promise<ProcessedEvent | null> {
    const { sub_id, cycle_id } = event.value;
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
    const { sub_id, event_kind, timestamp } = event.value;
    const column = LIFECYCLE_COLUMN_MAP[event_kind as number];

    if (!column) {
      logger.warn('Unknown lifecycle event_kind', { event_kind });
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
}

export const LIFECYCLE_COLUMN_MAP: Record<number, string> = {
  1: 'blockchain_created_at',
  2: 'blockchain_activated_at',
  3: 'blockchain_last_renewed_at',
  4: 'blockchain_canceled_at',
};

export const eventListener = new EventListener();