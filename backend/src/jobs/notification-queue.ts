import { Queue, Worker, Job } from 'bullmq';
import logger from '../config/logger';
import { pushService } from './push-service';
import { notificationDeadLetterService } from '../services/notification-dead-letter-service';
import { jobAlertService } from '../services/job-alert-service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = { url: REDIS_URL };

// Retry delays: 5m, 30m, 2h (in ms)
const RETRY_DELAYS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export interface NotificationJobData {
  type: 'push' | 'sms';
  userId: string;
  pushSubscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  phone?: string;
  payload: { title: string; body: string; url?: string };
}

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
  connection,
  defaultJobOptions: {
    attempts: RETRY_DELAYS.length + 1,
    backoff: {
      type: 'custom',
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const notificationWorker = new Worker<NotificationJobData>(
  'notifications',
  async (job: Job<NotificationJobData>) => {
    const { type, pushSubscription, payload } = job.data;

    if (type === 'push') {
      if (!pushSubscription) throw new Error('Missing pushSubscription');
      const result = await pushService.send(pushSubscription, payload);
      if (!result.success) {
        // Non-retryable (410/404 — subscription gone)
        if (result.metadata?.retryable === false) {
          logger.warn('Push subscription invalid, discarding job', { jobId: job.id });
          return;
        }
        throw new Error(result.error ?? 'Push delivery failed');
      }
      logger.info('Push notification delivered', { jobId: job.id });
    } else {
      throw new Error(`Unsupported notification type: ${type}`);
    }
  },
  {
    connection,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        RETRY_DELAYS[attemptsMade - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1],
    },
  }
);

notificationWorker.on('failed', (job, err) => {
  logger.error('Notification job failed', {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });

  jobAlertService.recordJobOutcome('notification-queue', false, err);

  // Move to dead-letter if exhausted all retries
  if (job && job.attemptsMade >= (RETRY_DELAYS.length + 1)) {
    const jobData = job.data as NotificationJobData;
    notificationDeadLetterService
      .moveToDeadLetter(
        jobData,
        job.id,
        job.attemptsMade,
        err.message,
        err.name
      )
      .catch((dlqErr) => {
        logger.error('Failed to move job to dead-letter queue:', dlqErr);
      });
  }
});

notificationWorker.on('completed', (job) => {
  logger.info('Notification job completed', { jobId: job.id });
  jobAlertService.recordJobOutcome('notification-queue', true);
});

export async function enqueueNotification(data: NotificationJobData): Promise<void> {
  await notificationQueue.add('send', data);
}

export async function shutdownNotificationQueue(): Promise<void> {
  logger.info('Closing BullMQ notification worker and queue');
  await notificationWorker.close();
  await notificationQueue.close();
  logger.info('BullMQ notification worker and queue closed');
}
