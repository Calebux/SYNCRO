/**
 * Risk Notification Service
 * Handles notifications for risk level changes
 */

import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { RiskLevel, RiskScore, RiskNotificationPayload } from '../../types/risk-detection';
import { emailService } from '../email-service';
import { pushService, PushSubscription } from '../push-service';
import { userPreferenceService } from '../user-preference-service';

export class RiskNotificationService {
  /**
   * Check if notification should be sent based on risk level change and user threshold
   */
  private async shouldNotify(userId: string, previousLevel: RiskLevel | undefined, newLevel: RiskLevel): Promise<boolean> {
    // Get user preferences for threshold check
    const prefs = await userPreferenceService.getPreferences(userId);
    const threshold = prefs.risk_notification_threshold || 'HIGH';

    const levelValues: Record<RiskLevel, number> = {
      'LOW': 1,
      'MEDIUM': 2,
      'HIGH': 3
    };

    // If new level is below threshold, don't notify
    if (levelValues[newLevel] < levelValues[threshold as RiskLevel]) {
      return false;
    }

    // Notify when transitioning UP to or above threshold
    if (previousLevel === undefined || levelValues[newLevel] > levelValues[previousLevel]) {
      return true;
    }

    // Also notify if we've been at HIGH for a while? (Deduplication handled by handleRiskChange)
    
    return false;
  }

  /**
   * Get user email from auth
   */
  private async getUserEmail(userId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) throw error;
      return data.user?.email || null;
    } catch (error) {
      logger.error('Error fetching user email for risk notification:', error);
      return null;
    }
  }

  /**
   * Get user's push subscription
   */
  private async getPushSub(userId: string): Promise<PushSubscription | null> {
    try {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) return null;

      return {
        endpoint: data.endpoint,
        keys: {
          p256dh: data.p256dh,
          auth: data.auth,
        },
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Send risk notification
   */
  private async sendNotification(payload: RiskNotificationPayload, riskScore: RiskScore): Promise<void> {
    try {
      const userEmail = await this.getUserEmail(payload.user_id);
      
      // 1. Email Notification
      if (userEmail) {
        await emailService.sendRiskAlert({
          to: userEmail,
          subscriptionName: payload.subscription_name,
          riskFactors: payload.risk_factors,
          renewalDate: new Date().toISOString(), // Fallback or get from sub
          recommendedAction: this.getRecommendation(payload.new_risk_level),
        });
      }

      // 2. Push Notification
      const pushSub = await this.getPushSub(payload.user_id);
      if (pushSub) {
        await pushService.send(pushSub, {
          title: `⚠️ ${payload.subscription_name} renewal at risk`,
          body: this.getRecommendation(payload.new_risk_level),
          url: '/dashboard',
        });
      }

      // 3. Store In-App Notification
      await supabase.from('notifications').insert({
        user_id: payload.user_id,
        type: 'risk_alert',
        message: this.buildNotificationMessage(payload),
        metadata: { 
          subscription_id: payload.subscription_id, 
          risk_score: riskScore 
        },
        read: false,
        created_at: new Date().toISOString(),
      });

      logger.info('Risk notification delivered via all active channels', {
        user_id: payload.user_id,
        subscription_id: payload.subscription_id
      });

    } catch (error) {
      logger.error('Error sending risk notification:', error);
    }
  }

  private getRecommendation(level: RiskLevel): string {
    if (level === 'HIGH') return 'Action required: Check your balance and approvals immediately.';
    if (level === 'MEDIUM') return 'Suggestion: Review your upcoming renewal and ensure sufficient funds.';
    return 'Everything looks good for now.';
  }

  /**
   * Build notification message based on risk level
   */
  private buildNotificationMessage(payload: RiskNotificationPayload): string {
    if (payload.new_risk_level === 'HIGH') {
      const topFactor = this.getFactorDescription(payload.risk_factors[0]);
      return `Your subscription "${payload.subscription_name}" is at HIGH risk: ${topFactor}.`;
    } else if (payload.new_risk_level === 'MEDIUM') {
      return `Warning: "${payload.subscription_name}" has increased renewal risk.`;
    } else {
      return `The risk for subscription "${payload.subscription_name}" has returned to LOW.`;
    }
  }

  /**
   * Helper to get human-readable factor description
   */
  private getFactorDescription(factor: any): string {
    if (!factor) return 'multiple factors';
    switch (factor.factor_type) {
      case 'consecutive_failures':
        return `${factor.details?.count || 0} consecutive failures`;
      case 'balance_projection':
        return 'low account balance';
      case 'approval_expiration':
        return 'expired payment approval';
      default:
        return String(factor.factor_type).replace(/_/g, ' ');
    }
  }

  /**
   * Handle risk level change and trigger notifications
   */
  async handleRiskChange(
    newRiskScore: RiskScore,
    subscriptionName: string,
    subscriptionPrice: number
  ): Promise<void> {
    try {
      const previousLevel = newRiskScore.last_notified_risk_level;
      const newLevel = newRiskScore.risk_level;

      // Check if notification should be sent based on level and user preferences
      if (!(await this.shouldNotify(newRiskScore.user_id, previousLevel, newLevel))) {
        return;
      }

      // Build notification payload
      const payload: RiskNotificationPayload = {
        subscription_id: newRiskScore.subscription_id,
        subscription_name: subscriptionName,
        subscription_price: subscriptionPrice,
        previous_risk_level: previousLevel,
        new_risk_level: newLevel,
        risk_factors: newRiskScore.risk_factors,
        user_id: newRiskScore.user_id,
      };

      // Send notification
      await this.sendNotification(payload, newRiskScore);

      // Update last notified risk level to prevent duplicates
      await this.updateLastNotifiedLevel(newRiskScore.subscription_id, newLevel);

    } catch (error) {
      logger.error('Error handling risk change:', error);
    }
  }

  /**
   * Update last notified risk level
   */
  private async updateLastNotifiedLevel(
    subscriptionId: string,
    riskLevel: RiskLevel
  ): Promise<void> {
    try {
      await supabase
        .from('subscription_risk_scores')
        .update({
          last_notified_risk_level: riskLevel,
          updated_at: new Date().toISOString(),
        })
        .eq('subscription_id', subscriptionId);
    } catch (error) {
      logger.error('Error updating last notified level:', error);
    }
  }

  /**
   * Process risk change with notification
   */
  async processRiskWithNotification(
    subscriptionId: string,
    userId: string,
    subscriptionName: string,
    subscriptionPrice: number,
    newRiskScore: RiskScore
  ): Promise<void> {
    try {
      await this.handleRiskChange(newRiskScore, subscriptionName, subscriptionPrice);
    } catch (error) {
      logger.error('Error processing risk with notification:', error);
    }
  }
}

export const riskNotificationService = new RiskNotificationService();
