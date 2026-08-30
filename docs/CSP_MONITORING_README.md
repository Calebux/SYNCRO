# CSP Violation Monitoring System

A comprehensive Content Security Policy (CSP) violation monitoring system that provides database persistence, real-time alerting, and historical analysis capabilities.

## Quick Start

### 1. Run Database Migration

```bash
cd backend
npm run db:migrate
```

Or manually:
```bash
psql $DATABASE_URL -f migrations/022_create_csp_violations.sql
```

### 2. Configure Environment Variables

Add to your backend `.env`:
```bash
# Enable CSP monitoring
CSP_MONITORING_ENABLED=true

# Alert thresholds
CSP_ALERT_HOURLY_RATE=100
CSP_ALERT_AFFECTED_USERS=50

# Sentry (required for alerting)
SENTRY_DSN=your_sentry_dsn_here
```

### 3. Start the Backend

```bash
npm run dev
```

The CSP monitoring cron jobs will start automatically.

### 4. Test the Implementation

```bash
node test-csp-monitoring.js
```

This will verify:
- Database table exists
- Materialized view exists
- Violations can be inserted
- Statistics can be queried
- Refresh function works

## Architecture

```
Browser → Next.js API → Backend API → Database
                    ↓
                  Sentry
                    ↓
                  Alerts
```

### Components

1. **Database Layer**
   - `csp_violations` table - Raw violation storage
   - `csp_violation_stats` view - Aggregated statistics
   - Indexes for performance
   - RLS policies for security

2. **Backend Services**
   - `csp-monitoring.ts` - Core monitoring logic
   - Violation persistence
   - Sentry integration
   - Alert checking
   - Statistics aggregation

3. **API Endpoints**
   - `POST /api/csp-violations` - Persist violations (internal)
   - `GET /api/csp-violations/stats` - Query statistics (admin)
   - `POST /api/csp-violations/refresh-stats` - Refresh view (admin)
   - `GET /api/csp-violations/user/:userId` - User violations (admin)

4. **Cron Jobs**
   - Stats refresh every 5 minutes
   - Alert checks every 5 minutes
   - Cleanup daily at 2 AM

## Usage

### Query Violation Statistics

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/stats?limit=20" | jq
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "violation_signature": "script-src::https://evil.com/script.js",
      "violated_directive": "script-src",
      "blocked_uri": "https://evil.com/script.js",
      "occurrence_count": 150,
      "affected_users": 25,
      "count_1h": 45
    }
  ]
}
```

### Get User Violations

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/user/{userId}?limit=50" | jq
```

### Manually Refresh Statistics

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/refresh-stats"
```

### Query Database Directly

```sql
-- Top violations in last 24 hours
SELECT * FROM csp_violation_stats 
WHERE count_24h > 0 
ORDER BY count_24h DESC 
LIMIT 20;

-- Recent violations
SELECT * FROM csp_violations 
WHERE created_at > NOW() - INTERVAL '1 hour' 
ORDER BY created_at DESC;

-- Violations by directive
SELECT 
  violated_directive,
  COUNT(*) as count,
  COUNT(DISTINCT user_id) as unique_users
FROM csp_violations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY violated_directive
ORDER BY count DESC;
```

## Alerting

### Alert Types

1. **High Rate Alert**
   - Triggers when violations exceed 100/hour
   - Configurable via `CSP_ALERT_HOURLY_RATE`
   - Sent to Sentry with error level

2. **High User Impact Alert**
   - Triggers when violations affect >50 users
   - Configurable via `CSP_ALERT_AFFECTED_USERS`
   - Sent to Sentry with error level

3. **New Violation Alert**
   - Triggers for first occurrence within 5 minutes
   - Sent to Sentry with warning level

### Viewing Alerts in Sentry

1. Navigate to your Sentry dashboard
2. Filter by tag: `csp_directive`
3. View violation details and context
4. Set up notification rules for your team

## Monitoring

### Logs

All CSP monitoring activities are logged:
```
[INFO] CSP violation persisted to database
[INFO] CSP stats refresh job completed successfully
[WARN] High CSP violation rate: script-src (150 violations in last hour)
[INFO] Cleaned up 1234 old CSP violations
```

### Metrics

Available metrics:
- Total violations per directive
- Violations per hour/day
- Unique users affected
- Unique IPs affected
- First/last seen timestamps

### Health Checks

Check if cron jobs are running:
```bash
# Check backend logs
tail -f logs/combined-*.log | grep CSP

# Check database for recent stats refresh
SELECT MAX(last_seen) FROM csp_violation_stats;
```

## Troubleshooting

### No Violations Being Stored

**Check:**
1. Database migration ran successfully
2. Backend server is running
3. CSP report endpoint is accessible
4. Browser is sending CSP reports

**Debug:**
```bash
# Check if table exists
psql $DATABASE_URL -c "SELECT COUNT(*) FROM csp_violations;"

# Check backend logs
tail -f logs/combined-*.log | grep "CSP violation"

# Test endpoint manually
curl -X POST http://localhost:3000/api/csp-report \
  -H "Content-Type: application/json" \
  -d '{"csp-report":{"document-uri":"https://example.com","violated-directive":"script-src"}}'
```

### Stats Not Updating

**Check:**
1. Cron jobs are running
2. Materialized view refresh is working
3. Database permissions are correct

**Debug:**
```bash
# Check cron job logs
tail -f logs/combined-*.log | grep "CSP stats refresh"

# Manually refresh stats
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/csp-violations/refresh-stats

# Check view directly
psql $DATABASE_URL -c "SELECT COUNT(*) FROM csp_violation_stats;"
```

### Alerts Not Firing

**Check:**
1. Sentry DSN is configured
2. Alert thresholds are appropriate
3. Violations are exceeding thresholds

**Debug:**
```bash
# Check Sentry configuration
echo $SENTRY_DSN

# Check violation counts
psql $DATABASE_URL -c "SELECT * FROM csp_violation_stats WHERE count_1h > 0;"

# Check backend logs for alert checks
tail -f logs/combined-*.log | grep "CSP alert"
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CSP_MONITORING_ENABLED` | `true` | Enable/disable CSP monitoring jobs |
| `CSP_ALERT_HOURLY_RATE` | `100` | Alert threshold for violations per hour |
| `CSP_ALERT_AFFECTED_USERS` | `50` | Alert threshold for affected users |
| `SENTRY_DSN` | - | Sentry DSN for alerting (required) |

### Cron Job Schedules

| Job | Schedule | Description |
|-----|----------|-------------|
| Stats Refresh | Every 5 minutes | Refresh materialized view |
| Alert Check | Every 5 minutes | Check for alert conditions |
| Cleanup | Daily at 2 AM | Remove violations older than 90 days |

### Database Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Retention Period | 90 days | How long to keep violations |
| Refresh Interval | 5 minutes | How often to update stats |
| Index Strategy | B-tree | For fast queries |

## Security

### Row-Level Security

- Only admins can read CSP violations
- Only service role can insert violations
- Violations are immutable (no updates)
- Only admins can delete violations

### API Security

- Admin authentication required for all endpoints
- Internal-only endpoint for persistence
- Request validation with Zod
- Rate limiting on admin endpoints

### Data Privacy

- IP addresses stored for analysis
- User IDs linked when available
- PII redaction in logs
- 90-day retention policy

## Performance

### Database

- Indexes on frequently queried columns
- Materialized view for aggregation
- Automatic cleanup prevents growth
- Connection pool monitoring

### API

- Non-blocking violation processing
- Async Sentry reporting
- No impact on user-facing endpoints

### Cron Jobs

- Lightweight operations
- Concurrent materialized view refresh
- Can be disabled if needed

## Documentation

- [Policy Tuning Workflow](./CSP_POLICY_TUNING.md) - Complete guide for tuning CSP policies
- [Incident Response Runbook](./CSP_INCIDENT_RESPONSE.md) - Step-by-step response procedures
- [Implementation Summary](../ISSUE_498_IMPLEMENTATION_SUMMARY.md) - Technical details

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the documentation
3. Check backend logs for errors
4. Contact the security team

## License

Same as the main project.
