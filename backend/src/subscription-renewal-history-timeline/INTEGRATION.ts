// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION GUIDE — wire RenewalHistoryModule into your existing code
// ─────────────────────────────────────────────────────────────────────────────

// 1. app.module.ts  ──────────────────────────────────────────────────────────
//    Add RenewalHistoryModule alongside your existing modules:
//
//    import { RenewalHistoryModule } from './renewal-history/renewal-history.module';
//
//    @Module({
//      imports: [
//        ...existingModules,
//        RenewalHistoryModule,
//      ],
//    })
//    export class AppModule {}


// 2. subscriptions.module.ts  ────────────────────────────────────────────────
//    Import RenewalHistoryModule so SubscriptionsService can inject the service:
//
//    @Module({
//      imports: [TypeOrmModule.forFeature([Subscription]), RenewalHistoryModule],
//      providers: [SubscriptionsService],
//      controllers: [SubscriptionsController],
//    })
//    export class SubscriptionsModule {}


// 3. subscriptions.service.ts  ───────────────────────────────────────────────
//    Inject RenewalHistoryService and call record() on every renewal event:

import { Injectable } from '@nestjs/common';
import { RenewalHistoryService } from './renewal-history/renewal-history.service';
import { RenewalEventType, RenewalStatus } from './renewal-history/renewal-history.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    // ...your existing dependencies...
    private readonly renewalHistory: RenewalHistoryService,
  ) {}

  async processRenewal(subscriptionId: string, userId: string) {
    try {
      // ...existing Stellar payment logic...
      const txHash = 'returned-from-stellar-sdk';
      const ledger = 52345678;

      // Record successful renewal
      await this.renewalHistory.record({
        subscriptionId,
        userId,
        eventType: RenewalEventType.RENEWED,
        status: RenewalStatus.SUCCESS,
        amount: 15.99,
        currency: 'USD',
        paymentMethod: 'stellar',
        transactionHash: txHash,
        blockchainLedger: ledger,
        blockchainVerified: true,
      });
    } catch (err) {
      // Record failed renewal
      await this.renewalHistory.record({
        subscriptionId,
        userId,
        eventType: RenewalEventType.FAILED,
        status: RenewalStatus.FAILED,
        notes: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async cancelSubscription(subscriptionId: string, userId: string, reason?: string) {
    // ...cancellation logic...

    await this.renewalHistory.record({
      subscriptionId,
      userId,
      eventType: RenewalEventType.CANCELLED,
      notes: reason,
    });
  }

  async sendRenewalReminder(subscriptionId: string, userId: string, channel: 'email' | 'sms' | 'push') {
    // ...send notification...

    await this.renewalHistory.record({
      subscriptionId,
      userId,
      eventType: RenewalEventType.REMINDER_SENT,
      channel,
    });
  }
}
