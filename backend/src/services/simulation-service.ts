import { supabase } from '../config/database';
import logger from '../config/logger';
import type { Subscription } from '../types/subscription';
import type {
  ProjectedRenewal,
  SimulationResult,
  SimulationSummary,
  RiskAssessment,
} from '../types/simulation';
import { addMonths, addQuarters, addWeeks, addYears } from 'date-fns';

/**
 * Simulation service for projecting subscription renewals
 */
export class SimulationService {
  /**
   * Calculate the next renewal date based on billing cycle
   * Uses calendar-aware math from date-fns
   */
  calculateNextRenewal(
    currentDate: Date,
    billingCycle: 'monthly' | 'quarterly' | 'yearly' | 'weekly' | 'annual'
  ): Date {
    switch (billingCycle) {
      case 'weekly':
        return addWeeks(currentDate, 1);
      case 'monthly':
        return addMonths(currentDate, 1);
      case 'quarterly':
        return addQuarters(currentDate, 1);
      case 'yearly':
      case 'annual':
        return addYears(currentDate, 1);
      default:
        return currentDate;
    }
  }

  /**
   * Generate all projected renewals for a single subscription within the period
   */
  projectSubscriptionRenewals(
    subscription: Subscription,
    endDate: Date
  ): ProjectedRenewal[] {
    const projections: ProjectedRenewal[] = [];
    
    // Skip if no next billing date
    if (!subscription.next_billing_date) {
      return projections;
    }
    
    let currentRenewalDate = new Date(subscription.next_billing_date);
    
    // Generate renewals while they fall within the projection period
    while (currentRenewalDate <= endDate) {
      projections.push({
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        provider: subscription.provider,
        amount: subscription.price,
        projectedDate: currentRenewalDate.toISOString(),
        billingCycle: subscription.billing_cycle,
        category: subscription.category,
      });
      
      // Calculate next renewal date
      currentRenewalDate = this.calculateNextRenewal(
        currentRenewalDate,
        subscription.billing_cycle
      );
    }
    
    return projections;
  }

  /**
   * Generate billing simulation for a user
   * @param userId - The authenticated user's ID
   * @param days - Number of days to project (default: 30, max: 365)
   * @param balance - Optional current balance for risk assessment
   * @returns Simulation result with projections and summary
   */
  async generateSimulation(
    userId: string,
    days: number = 30,
    balance?: number
  ): Promise<SimulationResult> {
    try {
      // Validate days parameter
      if (days < 1 || days > 365) {
        throw new Error('Days parameter must be between 1 and 365');
      }

      // Calculate projection period
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + days);

      // Fetch active subscriptions with next_billing_date
      const { data: subscriptions, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'trial'])
        .not('next_billing_date', 'is', null);

      if (error) {
        logger.error('Failed to fetch subscriptions for simulation:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      // Generate projections for all subscriptions
      const allProjections: ProjectedRenewal[] = [];
      
      for (const subscription of subscriptions || []) {
        const renewals = this.projectSubscriptionRenewals(
          subscription as Subscription,
          endDate
        );
        allProjections.push(...renewals);
      }

      // Sort projections by date (ascending)
      allProjections.sort((a, b) => 
        new Date(a.projectedDate).getTime() - new Date(b.projectedDate).getTime()
      );

      // Calculate summary statistics
      const totalProjectedSpend = allProjections.reduce(
        (sum, projection) => sum + projection.amount,
        0
      );

      const uniqueSubscriptionIds = new Set(
        allProjections.map(p => p.subscriptionId)
      );

      const summary: SimulationSummary = {
        totalProjectedSpend,
        projectionPeriodDays: days,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        subscriptionCount: uniqueSubscriptionIds.size,
        renewalCount: allProjections.length,
      };

      // Calculate risk assessment if balance is provided
      let risk: RiskAssessment | undefined;
      if (balance !== undefined) {
        const insufficientBalance = totalProjectedSpend > balance;
        risk = {
          insufficientBalance,
          currentBalance: balance,
          shortfall: insufficientBalance ? totalProjectedSpend - balance : 0,
        };
      }

      return {
        projections: allProjections,
        summary,
        risk,
      };
    } catch (error) {
      logger.error('Simulation generation failed:', error);
      throw error;
    }
  }
}

export const simulationService = new SimulationService();
