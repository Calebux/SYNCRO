import { supabase } from '../config/database';
import logger from '../config/logger';
import crypto from 'crypto';
import { NotificationJobData, notificationQueue } from '../jobs/notification-queue';

export interface NotificationDeadLetterEntry {
  id: string;
  user_id: string;
  job_type: 'push' | 'sms' | 'email';
  job_data: any;
  original_job_id: string;
  failure_count: number;
  last_error_message: string | null;
  last_error_code: string | null;
  dead_letter_at: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationDeadLetterReplay {
  id: string;
  notification_dlq_id: string;
  idempotency_key: string;
  replay_request_by: string | null;
  original_job_id: string | null;
  status: 'pending' | 'processing' | 'queued' | 'success' | 'failed';
  error_message: string | null;
  error_code: string | null;
  attempted_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Dead-Letter Service for Notification Jobs
 * Handles moving failed notification jobs to dead-letter queue and replaying them
 */
export class NotificationDeadLetterService {
  /**
   * Move a failed notification job to dead-letter queue
   */
  async moveToDeadLetter(
    jobData: NotificationJobData,
    originalJobId: string,
    failureCount: number,
    errorMessage: string,
    errorCode?: string
  ): Promise<NotificationDeadLetterEntry> {
    const { data, error } = await supabase
      .from('notification_dead_letter_queue')
      .insert({
        user_id: jobData.userId,
        job_type: jobData.type,
        job_data: jobData,
        original_job_id: originalJobId,
        failure_count: failureCount,
        last_error_message: errorMessage,
        last_error_code: errorCode || null,
        dead_letter_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to move notification job to dead-letter:', error);
      throw error;
    }

    logger.warn(`Notification job ${originalJobId} moved to dead-letter: ${errorMessage}`);
    return data as NotificationDeadLetterEntry;
  }

  /**
   * Get all dead-letter entries for a user
   */
  async getUserDeadLetters(userId: string): Promise<NotificationDeadLetterEntry[]> {
    const { data, error } = await supabase
      .from('notification_dead_letter_queue')
      .select('*')
      .eq('user_id', userId)
      .order('dead_letter_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch notification dead-letter entries:', error);
      throw error;
    }

    return data as NotificationDeadLetterEntry[];
  }

  /**
   * Get a specific dead-letter entry
   */
  async getDeadLetterEntry(userId: string, dlqId: string): Promise<NotificationDeadLetterEntry> {
    const { data, error } = await supabase
      .from('notification_dead_letter_queue')
      .select('*')
      .eq('id', dlqId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new Error('Dead-letter entry not found or access denied');
    }

    return data as NotificationDeadLetterEntry;
  }

  /**
   * Create a replay request for a dead-letter notification
   */
  async createReplayRequest(
    dlqId: string,
    userId: string,
    idempotencyKey?: string
  ): Promise<NotificationDeadLetterReplay> {
    // Verify the DLQ entry exists and belongs to the user
    const { data: dlqEntry, error: fetchError } = await supabase
      .from('notification_dead_letter_queue')
      .select('*')
      .eq('id', dlqId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !dlqEntry) {
      throw new Error('Dead-letter entry not found or access denied');
    }

    // Use provided idempotency key or generate one
    const key = idempotencyKey || crypto.randomUUID();

    try {
      const { data, error } = await supabase
        .from('notification_dead_letter_replays')
        .insert({
          notification_dlq_id: dlqId,
          idempotency_key: key,
          replay_request_by: userId,
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        // If the key already exists, return the existing replay (idempotency)
        if (error.code === '23505') { // Unique constraint violation
          const { data: existingReplay, error: fetchExistingError } = await supabase
            .from('notification_dead_letter_replays')
            .select('*')
            .eq('idempotency_key', key)
            .single();

          if (fetchExistingError) {
            throw error; // Re-throw original error if fetch fails
          }

          logger.info(`Idempotent replay: using existing replay ${existingReplay.id}`);
          return existingReplay as NotificationDeadLetterReplay;
        }
        throw error;
      }

      logger.info(`Created replay request ${data.id} for DLQ entry ${dlqId}`);
      return data as NotificationDeadLetterReplay;
    } catch (error) {
      logger.error('Failed to create replay request:', error);
      throw error;
    }
  }

  /**
   * Get replay history for a dead-letter entry
   */
  async getReplayHistory(userId: string, dlqId: string): Promise<NotificationDeadLetterReplay[]> {
    // Verify ownership
    const { data: dlqEntry } = await supabase
      .from('notification_dead_letter_queue')
      .select('id')
      .eq('id', dlqId)
      .eq('user_id', userId)
      .single();

    if (!dlqEntry) {
      throw new Error('Dead-letter entry not found or access denied');
    }

    const { data, error } = await supabase
      .from('notification_dead_letter_replays')
      .select('*')
      .eq('notification_dlq_id', dlqId)
      .order('attempted_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch replay history:', error);
      throw error;
    }

    return data as NotificationDeadLetterReplay[];
  }

  /**
   * Execute a replay for a dead-letter notification
   */
  async executeReplay(replayId: string): Promise<NotificationDeadLetterReplay> {
    // Update status to processing
    await supabase
      .from('notification_dead_letter_replays')
      .update({ status: 'processing' })
      .eq('id', replayId);

    try {
      // Fetch the replay and DLQ entry
      const { data: replay, error: replayError } = await supabase
        .from('notification_dead_letter_replays')
        .select('*, notification_dead_letter_queue!inner(*)')
        .eq('id', replayId)
        .single();

      if (replayError || !replay) {
        throw new Error('Replay request not found');
      }

      const dlqEntry = replay.notification_dead_letter_queue;
      const jobData: NotificationJobData = dlqEntry.job_data;

      // Enqueue the notification job back into the queue
      const newJob = await notificationQueue.add('send', jobData);

      logger.info(`Re-enqueued notification job: ${newJob.id}`);

      const { data, error } = await supabase
        .from('notification_dead_letter_replays')
        .update({
          status: 'queued',
          original_job_id: newJob.id,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', replayId)
        .select()
        .single();

      if (error) throw error;

      return data as NotificationDeadLetterReplay;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorCode = err instanceof Error && err.name ? err.name : 'UNKNOWN_ERROR';

      logger.error(`Replay ${replayId} encountered error:`, err);

      const { data, error } = await supabase
        .from('notification_dead_letter_replays')
        .update({
          status: 'failed',
          error_message: errorMsg,
          error_code: errorCode,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', replayId)
        .select()
        .single();

      if (error) throw error;
      return data as NotificationDeadLetterReplay;
    }
  }

  /**
   * Get statistics for dead-letter notifications
   */
  async getDeadLetterStats(userId: string): Promise<{
    total_dead_letters: number;
    dead_letters_24h: number;
    dead_letters_7d: number;
    by_type: Array<{
      job_type: string;
      count: number;
      most_recent: string;
    }>;
  }> {
    const { data, error } = await supabase
      .from('notification_dead_letter_stats')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      logger.error('Failed to fetch dead-letter stats:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return {
        total_dead_letters: 0,
        dead_letters_24h: 0,
        dead_letters_7d: 0,
        by_type: [],
      };
    }

    const total_dead_letters = data.reduce((sum: number, row: any) => sum + (row.total_dead_letters || 0), 0);
    const dead_letters_24h = data.reduce((sum: number, row: any) => sum + (row.dead_letters_24h || 0), 0);
    const dead_letters_7d = data.reduce((sum: number, row: any) => sum + (row.dead_letters_7d || 0), 0);

    return {
      total_dead_letters,
      dead_letters_24h,
      dead_letters_7d,
      by_type: data.map((row: any) => ({
        job_type: row.job_type,
        count: row.total_dead_letters,
        most_recent: row.dead_letter_at,
      })),
    };
  }
}

export const notificationDeadLetterService = new NotificationDeadLetterService();
