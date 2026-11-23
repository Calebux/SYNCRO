# Provider usage events

Committed metering rows create version `1.0.0` `usage.committed` events in the transactional `provider_usage_event_outbox`. The event contains the stable outbox `id`, commit timestamp, agent identifier, route, unit, units, and amount. It excludes user identity, request bodies, prompts, credentials, and correlation IDs.

The outbox dispatcher uses leases and retries. A sink can receive the same event more than once if delivery succeeded but acknowledgement failed; sinks must deduplicate by `id`. The integrated backend worker sends batches to `PROVIDER_USAGE_WEBHOOK_URL` and signs the exact request body with HMAC-SHA256 in `x-syncro-usage-signature`. Configure `PROVIDER_USAGE_WEBHOOK_SECRET` alongside the endpoint. The URL must use HTTPS (localhost is allowed for development).

The `@syncro/metering` package also exports `UsageEventDispatcher`, `WebhookUsageEventSink`, and structural `NatsUsageEventSink` and `KafkaUsageEventSink` adapters. NATS and Kafka clients are supplied by the hosting application so this package does not pin a broker client dependency. NATS publishes a versioned batch to the configured subject; Kafka uses the event ID as the record key.

## Settlement dry run

Operators can run `npx tsx scripts/settlement-dry-run.ts batch.json`. The JSON file is an array of candidates with `channelId`, `amount`, `nonce`, `expectedNonce`, `capacity`, `settled`, `feeBase`, `feePerOperation`, and `operationCount`. Integer amounts and fees must be decimal strings to preserve precision. The command prints a JSON report to stdout and performs no signing, persistence, or network submission. `would_fail` rows list all detected failures; fee values are estimates supplied by the operator's current network fee model.
