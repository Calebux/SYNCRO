/**
 * Shared user domain models
 */

export type UserRole = 'user' | 'admin' | 'team_member';
export type SubscriptionTier = 'free' | 'basic' | 'premium' | 'enterprise';

/**
 * Core user profile entity
 */
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

/**
 * User preferences
 */
export interface UserPreferences {
  userId: string;
  currency: string;
  timezone: string;
  language: string;
  theme?: 'light' | 'dark' | 'auto';
  
  // Notification settings
  emailNotifications: boolean;
  pushNotifications: boolean;
  telegramNotifications: boolean;
  
  // Quiet hours
  quietHoursEnabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  
  // Digest settings
  monthlyDigestEnabled: boolean;
  weeklyDigestEnabled: boolean;
  
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for updating user preferences
 */
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
