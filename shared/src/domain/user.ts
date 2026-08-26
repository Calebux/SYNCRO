/**
 * Hand-written user domain types (not generated from schema or ABI).
 */

export type UserRole = 'user' | 'admin' | 'team_member';
export type SubscriptionTier = 'free' | 'basic' | 'premium' | 'enterprise';

export interface UserProfile {
  id: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  subscriptionTier?: SubscriptionTier;
  role?: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  userId: string;
  currency: string;
  timezone: string;
  language: string;
  theme?: 'light' | 'dark' | 'auto';
  emailNotifications: boolean;
  pushNotifications: boolean;
  telegramNotifications: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  monthlyDigestEnabled: boolean;
  weeklyDigestEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserPreferencesInput {
  currency?: string;
  timezone?: string;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  telegramNotifications?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  monthlyDigestEnabled?: boolean;
  weeklyDigestEnabled?: boolean;
}
