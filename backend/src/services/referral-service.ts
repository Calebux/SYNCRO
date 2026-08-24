import crypto from 'crypto';
import { supabase, databaseRepository, databaseRepository } from '../config/database';
import logger from '../config/logger';

export interface ReferralStats {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  conversions: number;
  rewardsEarned: number; // months of free premium
}

const BASE_URL = process.env.FRONTEND_URL || 'https://syncro.app';

function generateCode(): string {
  return crypto.randomBytes(4).toString('hex'); // 8-char hex code
}

export class ReferralService {
  /** Get (or lazily create) the referral code for a user. */
  async getOrCreateCode(userId: string): Promise<string> {
    const { data: profile, error } = await databaseRepository
      .from('profiles')
      .select('referral_code')
      .eq('id', userId)
      .single();

    if (error) throw error;

    if (profile?.referral_code) return profile.referral_code;

    // Generate a unique code
    let code = generateCode();
    let attempts = 0;
    while (attempts < 5) {
      const { data: existing } = await databaseRepository
        .from('profiles')
        .select('id')
        .eq('referral_code', code)
        .maybeSingle();

      if (!existing) break;
      code = generateCode();
      attempts++;
    }

    const { error: updateError } = await databaseRepository
      .from('profiles')
      .update({ referral_code: code })
      .eq('id', userId);

    if (updateError) throw updateError;
    return code;
  }

  /** Validate a referral code at signup and record the referral. */
  async validateAndRecord(referralCode: string, referredUserId: string): Promise<void> {
    const { data: referrer, error } = await databaseRepository
      .from('profiles')
      .select('id')
      .eq('referral_code', referralCode)
      .maybeSingle();

    if (error || !referrer) {
      logger.warn('Invalid referral code used', { referralCode, referredUserId });
      return;
    }

    if (referrer.id === referredUserId) return; // self-referral guard

    // Set referred_by on the new user's profile
    await databaseRepository
      .from('profiles')
      .update({ referred_by: referrer.id })
      .eq('id', referredUserId);

    // Create referral record
    await databaseRepository.from('referrals').insert({
      referrer_user_id: referrer.id,
      referred_user_id: referredUserId,
      referral_code: referralCode,
      status: 'signed_up',
      signed_up_at: new Date().toISOString(),
    });
  }

  /**
   * Mark a referral as converted (called when referred user adds first subscription).
   * Grants reward to referrer.
   */
  async markConverted(referredUserId: string): Promise<void> {
    const { data: referral, error } = await databaseRepository
      .from('referrals')
      .select('id, referrer_user_id, reward_granted')
      .eq('referred_user_id', referredUserId)
      .eq('status', 'signed_up')
      .maybeSingle();

    if (error || !referral || referral.reward_granted) return;

    await databaseRepository
      .from('referrals')
      .update({
        status: 'converted',
        converted_at: new Date().toISOString(),
        reward_granted: true,
      })
      .eq('id', referral.id);

    logger.info('Referral converted, reward granted', {
      referralId: referral.id,
      referrerId: referral.referrer_user_id,
      referredId: referredUserId,
    });
  }

  /** Get referral stats for a user. */
  async getStats(userId: string): Promise<ReferralStats> {
    const code = await this.getOrCreateCode(userId);

    const { data: referrals, error } = await databaseRepository
      .from('referrals')
      .select('status, reward_granted')
      .eq('referrer_user_id', userId);

    if (error) throw error;

    const conversions = (referrals ?? []).filter((r) => r.status === 'converted').length;
    const rewardsEarned = (referrals ?? []).filter((r) => r.reward_granted).length;

    return {
      referralCode: code,
      referralLink: `${BASE_URL}/ref/${code}`,
      totalReferrals: (referrals ?? []).length,
      conversions,
      rewardsEarned,
    };
  }
}

export const referralService = new ReferralService();
