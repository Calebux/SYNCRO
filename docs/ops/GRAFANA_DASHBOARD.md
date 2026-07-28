# Grafana Dashboard & SLI Metrics Guide

> **Issue #1099 · Area: ops / monitoring**  
> Documentation for core SYNCRO Service Level Indicators (SLIs) exported via `/metrics` and Grafana panel definitions.

---

## 1. Metrics Endpoint Overview

The SYNCRO backend exposes an unauthenticated Prometheus-compatible metrics endpoint at:
- `GET /metrics`
- `GET /api/metrics`

### Content-Type Negotiation
- **Prometheus Text Format (Default):** Returns standard `text/plain; version=0.0.4; charset=utf-8` exposition format for Prometheus scrapers.
- **JSON Format:** Returns structured JSON snapshot when requested with `Accept: application/json` or `?format=json`.

---

## 2. Core SLI Metrics Reference

| Metric Name | Type | Description | Unit / Range |
|-------------|------|-------------|--------------|
| `syncro_renewal_success_rate_pct` | Gauge | Percentage of successful subscription renewal executions in rolling 24h window | Percentage (`0.0` - `100.0`) |
| `syncro_webhook_processing_lag_ms` | Gauge | Webhook delivery processing lag (`quantile="avg"`, `quantile="p95"`) | Milliseconds (`ms`) |
| `syncro_notification_queue_depth` | Gauge | BullMQ notification queue depth by state (`state="total"`, `"active"`, `"waiting"`, `"delayed"`, `"failed"`) | Count |
| `syncro_dead_letter_count` | Gauge | Dead-letter queue item counts in last 24h by pipeline (`pipeline="notification"`, `"renewal"`, `"webhook"`, `"total"`) | Count |

---

## 3. Grafana Panel Configurations

### Panel 1: Renewal Success Rate (%)

- **Title:** Subscription Renewal Success Rate (24h)
- **Visualization Type:** Stat / Gauge + Time Series
- **PromQL Query:**
  ```promql
  syncro_renewal_success_rate_pct
  ```
- **Value Mappings & Thresholds:**
  - `> 98.0%`: Green (Healthy)
  - `95.0% - 98.0%`: Yellow (Warning - P2)
  - `< 95.0%`: Red (Critical - P1)
- **Unit:** Percent (`0-100%`)

---

### Panel 2: Webhook Processing Lag (ms)

- **Title:** Webhook Delivery Processing Lag
- **Visualization Type:** Time Series Line Chart
- **PromQL Queries:**
  - **P95 Lag:**
    ```promql
    syncro_webhook_processing_lag_ms{quantile="p95"}
    ```
  - **Average Lag:**
    ```promql
    syncro_webhook_processing_lag_ms{quantile="avg"}
    ```
- **Value Mappings & Thresholds:**
  - `< 500 ms`: Green
  - `500 ms - 2000 ms`: Yellow
  - `> 2000 ms`: Red (P2 Alert)
- **Unit:** Milliseconds (`ms`)

---

### Panel 3: Notification Queue Depth

- **Title:** Notification Queue Backlog & Worker States
- **Visualization Type:** Stacked Area / Time Series Chart
- **PromQL Queries:**
  - **Active Jobs:** `syncro_notification_queue_depth{state="active"}`
  - **Waiting Jobs:** `syncro_notification_queue_depth{state="waiting"}`
  - **Delayed Jobs:** `syncro_notification_queue_depth{state="delayed"}`
  - **Failed Jobs:** `syncro_notification_queue_depth{state="failed"}`
- **Alert Thresholds:**
  - `state="waiting" > 100`: Warning
  - `state="failed" > 50`: Critical (P1 Page)
- **Unit:** Short (Count)

---

### Panel 4: Dead-Letter Queue Breakdown (24h Window)

- **Title:** Dead-Letter Queue Counts (24h)
- **Visualization Type:** Bar Gauge / Multi-Stat
- **PromQL Queries:**
  - **Notification DLQ:**
    ```promql
    syncro_dead_letter_count{pipeline="notification"}
    ```
  - **Renewal DLQ:**
    ```promql
    syncro_dead_letter_count{pipeline="renewal"}
    ```
  - **Webhook DLQ:**
    ```promql
    syncro_dead_letter_count{pipeline="webhook"}
    ```
  - **Total DLQ:**
    ```promql
    syncro_dead_letter_count{pipeline="total"}
    ```
- **Alert Thresholds:**
  - `total > 5`: Warning
  - `total > 15`: Critical P1 Escalation
- **Unit:** Short (Count)

---

## 4. Prometheus Scrape Configuration (`prometheus.yml`)

Add the following scrape job to your Prometheus configuration file:

```yaml
scrape_configs:
  - job_name: 'syncro-backend'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['api.example.com:3001']
```

---

## 5. Sample Grafana Dashboard JSON Snippet

Import the JSON snippet below into Grafana:

```json
{
  "annotations": { "list": [] },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 0,
  "id": null,
  "links": [],
  "liveNow": false,
  "panels": [
    {
      "title": "Renewal Success Rate (%)",
      "type": "gauge",
      "targets": [
        { "expr": "syncro_renewal_success_rate_pct", "refId": "A" }
      ],
      "fieldConfig": {
        "defaults": {
          "min": 0,
          "max": 100,
          "unit": "percent",
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "yellow", "value": 95 },
              { "color": "green", "value": 98 }
            ]
          }
        }
      }
    },
    {
      "title": "Webhook Processing Lag (ms)",
      "type": "timeseries",
      "targets": [
        { "expr": "syncro_webhook_processing_lag_ms{quantile=\"p95\"}", "legendFormat": "P95 Lag", "refId": "A" },
        { "expr": "syncro_webhook_processing_lag_ms{quantile=\"avg\"}", "legendFormat": "Avg Lag", "refId": "B" }
      ]
    },
    {
      "title": "Notification Queue Depth",
      "type": "timeseries",
      "targets": [
        { "expr": "syncro_notification_queue_depth{state=\"waiting\"}", "legendFormat": "Waiting", "refId": "A" },
        { "expr": "syncro_notification_queue_depth{state=\"active\"}", "legendFormat": "Active", "refId": "B" },
        { "expr": "syncro_notification_queue_depth{state=\"failed\"}", "legendFormat": "Failed", "refId": "C" }
      ]
    },
    {
      "title": "Dead Letter Counts (24h)",
      "type": "bargauge",
      "targets": [
        { "expr": "syncro_dead_letter_count", "legendFormat": "{{pipeline}}", "refId": "A" }
      ]
    }
  ],
  "refresh": "10s",
  "schemaVersion": 38,
  "style": "dark",
  "tags": ["syncro", "ops", "slis"],
  "time": { "from": "now-6h", "to": "now" },
  "title": "SYNCRO Core SLIs Dashboard"
}
```
