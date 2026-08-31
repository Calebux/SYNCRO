import { supabase } from '../config/database';
import logger from '../config/logger';

export interface ReminderSettings {
    user_id: string;
    reminder_days_before: number[];
    created_at: string;
    updated_at: string;
}

export interface PartialReminderSettings {
    reminder_days_before?: number[];
}

export class ReminderSettingsService {
    private readonly defaultSettings: Omit<ReminderSettings, 'user_id' | 'created_at' | 'updated_at'> = {
        reminder_days_before: [7, 3, 1],
    };

    /**
     * Get reminder settings, returning defaults if not found
     */
    async getSettings(userId: string): Promise<ReminderSettings> {
        try {
            const { data, error } = await supabase
                .from('reminder_settings')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error && error.code !== 'PGRST116') {
                // PGRST116 is "no rows returned"
                logger.error(`Error fetching reminder settings for user ${userId}:`, error);
                throw error;
            }

            if (!data) {
                return {
                    user_id: userId,
                    ...this.defaultSettings,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };
            }

            return data as ReminderSettings;
        } catch (error) {
            logger.error(`Unexpected error fetching reminder settings for user ${userId}:`, error);
            return {
                user_id: userId,
                ...this.defaultSettings,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
        }
    }

    /**
     * Update reminder settings partially
     */
    async updateSettings(
        userId: string,
        updates: PartialReminderSettings
    ): Promise<ReminderSettings> {
        try {
            // Fetch current settings to ensure safe merging
            const current = await this.getSettings(userId);

            const merged: Partial<ReminderSettings> = {
                ...current,
                ...updates,
            };

            // Remove keys that shouldn't be updated directly
            delete merged.user_id;
            delete (merged as any).created_at;
            delete (merged as any).updated_at;

            const { data, error } = await supabase
                .from('reminder_settings')
                .upsert({
                    user_id: userId,
                    ...merged,
                })
                .select()
                .single();

            if (error) {
                logger.error(`Error updating reminder settings for user ${userId}:`, error);
                throw error;
            }

            return data as ReminderSettings;
        } catch (error) {
            logger.error(`Unexpected error updating reminder settings for user ${userId}:`, error);
            throw error;
        }
    }
}

export const reminderSettingsService = new ReminderSettingsService();