/**
 * POST /api/webhooks/paypal
 *
 * Thin adapter over the shared ingestion pipeline (issue #1283). All
 * verification, persistence, deduplication, retry and replay behaviour lives in
 * `services/webhook-ingestion`; this file contributes only the provider choice.
 */

import { paypalAdapter } from '../services/webhook-ingestion';
import { createWebhookIngestRouter } from './webhook-ingest-route';

export default createWebhookIngestRouter(paypalAdapter);
