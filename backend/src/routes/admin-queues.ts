import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';
import { notificationQueue } from '../jobs/notification-queue';
import { adminAuth } from '../middleware/admin';
import { createAdminLimiter } from '../middleware/rate-limit-factory';

let boardInitialized = false;
const serverAdapter = new ExpressAdapter();

function ensureBullBoard(): void {
  if (boardInitialized) return;
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(notificationQueue)],
    serverAdapter,
  });
  boardInitialized = true;
}

const router = Router();

router.use(createAdminLimiter());
router.use(adminAuth);
router.use((req, res, next) => {
  ensureBullBoard();
  serverAdapter.getRouter()(req, res, next);
});

export default router;

/**
 * Collect queue health metrics for the monitoring endpoint.
 */
export async function getQueueHealthMetrics(): Promise<{
  queues: Array<{
    name: string;
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }>;
  healthy: boolean;
}> {
  const counts = await notificationQueue.getJobCounts(
    'active',
    'waiting',
    'completed',
    'failed',
    'delayed',
    'paused',
  );

  const queues = [
    {
      name: notificationQueue.name,
      active: counts.active ?? 0,
      waiting: counts.waiting ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      paused: counts.paused ?? 0,
    },
  ];

  const healthy = queues.every((q) => q.failed < 50);

  return { queues, healthy };
}
