import request from 'supertest';
import express from 'express';
import metricsRouter from '../src/routes/metrics';
import { sliMetricsService } from '../src/services/sli-metrics-service';

jest.mock('../src/services/sli-metrics-service', () => ({
  sliMetricsService: {
    getSliMetrics: jest.fn(),
    formatPrometheusMetrics: jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

const app = express();
app.use(express.json());
app.use('/metrics', metricsRouter);
app.use('/api/metrics', metricsRouter);

describe('GET /metrics Endpoint', () => {
  const mockSliPayload = {
    renewal_success_rate_pct: 98.5,
    webhook_processing_lag_ms: {
      avg_ms: 120,
      p95_ms: 350,
    },
    notification_queue_depth: {
      total: 10,
      active: 2,
      waiting: 5,
      delayed: 3,
      failed: 0,
    },
    dead_letter_counts: {
      notification_dlq_24h: 1,
      renewal_dlq_24h: 0,
      webhook_dlq_24h: 2,
      total_dlq_24h: 3,
    },
    calculated_at: '2026-07-25T12:00:00.000Z',
  };

  const mockPrometheusText = `
# HELP syncro_renewal_success_rate_pct Percentage of successful subscription renewal executions
# TYPE syncro_renewal_success_rate_pct gauge
syncro_renewal_success_rate_pct 98.5

# HELP syncro_webhook_processing_lag_ms Webhook delivery processing lag in milliseconds
# TYPE syncro_webhook_processing_lag_ms gauge
syncro_webhook_processing_lag_ms{quantile="avg"} 120
syncro_webhook_processing_lag_ms{quantile="p95"} 350

# HELP syncro_notification_queue_depth Current job depth in notification queue by state
# TYPE syncro_notification_queue_depth gauge
syncro_notification_queue_depth{state="total"} 10

# HELP syncro_dead_letter_count Dead-letter queue item counts by pipeline
# TYPE syncro_dead_letter_count gauge
syncro_dead_letter_count{pipeline="total"} 3
`.trim();

  beforeEach(() => {
    jest.clearAllMocks();
    (sliMetricsService.getSliMetrics as jest.Mock).mockResolvedValue(mockSliPayload);
    (sliMetricsService.formatPrometheusMetrics as jest.Mock).mockResolvedValue(mockPrometheusText);
  });

  it('returns Prometheus text exposition format by default', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('syncro_renewal_success_rate_pct 98.5');
    expect(res.text).toContain('syncro_webhook_processing_lag_ms');
    expect(res.text).toContain('syncro_notification_queue_depth');
    expect(res.text).toContain('syncro_dead_letter_count');
    expect(sliMetricsService.formatPrometheusMetrics).toHaveBeenCalledTimes(1);
  });

  it('returns JSON format when Accept header is application/json', async () => {
    const res = await request(app)
      .get('/metrics')
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.renewal_success_rate_pct).toBe(98.5);
    expect(res.body.webhook_processing_lag_ms.avg_ms).toBe(120);
    expect(res.body.notification_queue_depth.total).toBe(10);
    expect(res.body.dead_letter_counts.total_dlq_24h).toBe(3);
    expect(sliMetricsService.getSliMetrics).toHaveBeenCalledTimes(1);
  });

  it('returns JSON format when ?format=json query parameter is present', async () => {
    const res = await request(app).get('/metrics?format=json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.renewal_success_rate_pct).toBe(98.5);
    expect(sliMetricsService.getSliMetrics).toHaveBeenCalledTimes(1);
  });

  it('works on /api/metrics alias route', async () => {
    const res = await request(app).get('/api/metrics?format=json');

    expect(res.status).toBe(200);
    expect(res.body.renewal_success_rate_pct).toBe(98.5);
  });

  it('returns 500 status when metrics calculation fails', async () => {
    (sliMetricsService.formatPrometheusMetrics as jest.Mock).mockRejectedValue(
      new Error('DB failure'),
    );

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to generate metrics snapshot');
  });
});
