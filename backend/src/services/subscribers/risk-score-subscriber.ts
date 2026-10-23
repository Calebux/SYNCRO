import { riskDetectionService } from '../risk-detection/risk-detection-service';
import type { DomainEvent, SubscriptionCreatedEvent, RenewalSucceededEvent, RenewalFailedEvent, PaymentFailedEvent } from '@syncro/shared/domain-events';

export class RiskScoreSubscriber {
  async handle(event: DomainEvent): Promise<void> {
    switch (event.eventName) {
      case 'subscription.created':
        await this.handleSubscriptionCreated(event as SubscriptionCreatedEvent);
        break;
      case 'renewal.succeeded':
        await this.handleRenewalSucceeded(event as RenewalSucceededEvent);
        break;
      case 'renewal.failed':
        await this.handleRenewalFailed(event as RenewalFailedEvent);
        break;
      case 'payment.failed':
        await this.handlePaymentFailed(event as PaymentFailedEvent);
        break;
    }
  }

  private async handleSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    try {
      const assessment = await riskDetectionService.computeRiskLevel(event.subscriptionId);
      await riskDetectionService.saveRiskScore(assessment, event.userId);
    } catch (err) {
      throw new Error(`Risk score calculation failed after subscription creation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleRenewalSucceeded(event: RenewalSucceededEvent): Promise<void> {
    try {
      const assessment = await riskDetectionService.computeRiskLevel(event.subscriptionId);
      await riskDetectionService.saveRiskScore(assessment, event.userId);
    } catch (err) {
      throw new Error(`Risk score calculation failed after renewal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleRenewalFailed(event: RenewalFailedEvent): Promise<void> {
    try {
      const assessment = await riskDetectionService.computeRiskLevel(event.subscriptionId);
      await riskDetectionService.saveRiskScore(assessment, event.userId);
    } catch (err) {
      throw new Error(`Risk score calculation failed after renewal failure: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handlePaymentFailed(event: PaymentFailedEvent): Promise<void> {
    try {
      await riskDetectionService.recordRenewalAttempt(event.subscriptionId, false, event.reason);
    } catch (err) {
      throw new Error(`Failed to record renewal attempt after payment failure: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const riskScoreSubscriber = new RiskScoreSubscriber();
