import { supabase } from '../config/database';
import logger from '../config/logger';
import { UserPreferences, PartialUserPreferences } from '../types/reminder';

export class UserPreferenceService {
    private readonly defaultPreferences: Omit<UserPreferences, 'user_id' | 'updated_at'> = {
        notification_channels: ['email'],
        reminder_timing: [7, 3, 1],
        email_opt_ins: {
            marketing: false,
            reminders: true,
            updates: true,
        },
        automation_flags: {
            auto_renew: false,
            auto_retry: true,
        },
        risk_notification_threshold: 'HIGH',
    };

    /**
     * Get user preferences, returning defaults if not found
     */
    async getPreferences(userId: string): Promise<UserPreferences> {
        try {
            const { data, error } = await supabase
                .from('user_preferences')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error && error.code !== 'PGRST116') {
                // PGRST116 is "no rows returned"
                logger.error(`Error fetching preferences for user ${userId}:`, error);
                throw error;
            }

            if (!data) {
                return {
                    user_id: userId,
                    ...this.defaultPreferences,
                    updated_at: new Date().toISOString(),
                };
            }

            return data as UserPreferences;
        } catch (error) {
            logger.error(`Unexpected error fetching preferences for user ${userId}:`, error);
            return {
                user_id: userId,
                ...this.defaultPreferences,
                updated_at: new Date().toISOString(),
            };
        }
    }

    /**
     * Update user preferences partially
     */
    async updatePreferences(
        userId: string,
        updates: PartialUserPreferences
    ): Promise<UserPreferences> {
        try {
            // Fetch current preferences to ensure safe merging of nested objects
            const current = await this.getPreferences(userId);

            const merged: Partial<UserPreferences> = {
                ...current,
                ...updates,
                // Deep merge for nested objects if they are partially provided
                email_opt_ins: updates.email_opt_ins
                    ? { ...current.email_opt_ins, ...updates.email_opt_ins }
                    : current.email_opt_ins,
                automation_flags: updates.automation_flags
                    ? { ...current.automation_flags, ...updates.automation_flags }
                    : current.automation_flags,
            };

            // Remove keys that shouldn't be updated directly via this method
            delete merged.user_id;
            delete (merged as any).updated_at;
            delete (merged as any).created_at;

            const { data, error } = await supabase
                .from('user_preferences')
                .upsert({
                    user_id: userId,
                    ...merged,
                })
                .select()
                .single();

            if (error) {
                logger.error(`Error updating preferences for user ${userId}:`, error);
                throw error;
            }

            return data as UserPreferences;
        } catch (error) {
            logger.error(`Unexpected error updating preferences for user ${userId}:`, error);
            throw error;
        }
    }
}

export const userPreferenceService = new UserPreferenceService();
