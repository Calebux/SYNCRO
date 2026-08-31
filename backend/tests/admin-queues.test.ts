import { getQueueHealthMetrics } from '../src/routes/admin-queues';

jest.mock('../src/jobs/notification-queue', () => ({
  notificationQueue: {
    name: 'notifications',
    getJobCounts: jest.fn().mockResolvedValue({
      active: 2,
      waiting: 5,
      completed: 100,
      failed: 1,
      delayed: 0,
      paused: 0,
    }),
  },
}));

describe('getQueueHealthMetrics', () => {
  it('should return queue stats from BullMQ', async () => {
    const metrics = await getQueueHealthMetrics();

    expect(metrics.queues).toHaveLength(1);
    expect(metrics.queues[0]).toEqual({
      name: 'notifications',
      active: 2,
      waiting: 5,
      completed: 100,
      failed: 1,
      delayed: 0,
      paused: 0,
    });
    expect(metrics.healthy).toBe(true);
  });

  it('should mark unhealthy when failed jobs exceed threshold', async () => {
    const { notificationQueue } = require('../src/jobs/notification-queue');
    notificationQueue.getJobCounts.mockResolvedValueOnce({
      active: 0,
      waiting: 0,
      completed: 10,
      failed: 75,
      delayed: 0,
      paused: 0,
    });

    const metrics = await getQueueHealthMetrics();
    expect(metrics.healthy).toBe(false);
  });
});
