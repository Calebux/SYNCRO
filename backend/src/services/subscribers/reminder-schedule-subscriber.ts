import { reminderEngine } from '../reminder-engine';
import type { DomainEvent, SubscriptionCreatedEvent, SubscriptionUpdatedEvent, SubscriptionDeletedEvent, SubscriptionCancelledEvent, SubscriptionRestoredEvent } from '@syncro/shared/domain-events';

export class ReminderScheduleSubscriber {
  async handle(event: DomainEvent): Promise<void> {
    switch (event.eventName) {
      case 'subscription.created':
      case 'subscription.restored':
        await this.handleSubscriptionCreatedOrRestored(event as SubscriptionCreatedEvent | SubscriptionRestoredEvent);
        break;
      case 'subscription.updated':
        await this.handleSubscriptionUpdated(event as SubscriptionUpdatedEvent);
        break;
      case 'subscription.deleted':
      case 'subscription.cancelled':
        await this.handleSubscriptionDeletedOrCancelled(event as SubscriptionDeletedEvent | SubscriptionCancelledEvent);
        break;
    }
  }

  private async handleSubscriptionCreatedOrRestored(event: SubscriptionCreatedEvent | SubscriptionRestoredEvent): Promise<void> {
    try {
      await reminderEngine.scheduleReminders();
    } catch (err) {
      throw new Error(`Reminder scheduling failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleSubscriptionUpdated(event: SubscriptionUpdatedEvent): Promise<void> {
    if (!event.updatedFields.includes('status') && !event.updatedFields.includes('next_billing_date')) {
      return;
    }
    try {
      await reminderEngine.scheduleReminders();
    } catch (err) {
      throw new Error(`Reminder scheduling failed after update: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleSubscriptionDeletedOrCancelled(event: SubscriptionDeletedEvent | SubscriptionCancelledEvent): Promise<void> {
    try {
      await reminderEngine.scheduleReminders();
    } catch (err) {
      throw new Error(`Reminder scheduling cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const reminderScheduleSubscriber = new ReminderScheduleSubscriber();
