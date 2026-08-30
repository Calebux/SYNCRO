# Issue #498: CSP Violation Monitoring Implementation Summary

## Overview

Implemented a comprehensive Content Security Policy (CSP) violation monitoring system that persists violations to a database, integrates with Sentry for real-time alerting, and provides aggregation/alerting capabilities for high-frequency violations.

## Problem Statement

The CSP report endpoint (`client/app/api/csp-report/route.ts`) was only logging violations to the console with TODO notes for production behavior. This made it impossible to:
- Query violations outside runtime logs
- Trigger alerts for violation spikes
- Analyze violation patterns over time
- Tune CSP policies based on historical data

## Solution Architecture

### Components Implemented

1. **Database Layer**
   - `csp_violations` table for raw violation storage
   - `csp_violation_stats` materialized view for aggregated statistics
   - Indexes for optimal query performance
   - Row-level security policies

2. **Backend Services**
   - `csp-monitoring.ts` service for violation persistence and analysis
   - Sentry integration for real-time monitoring
   - Alert checking with configurable thresholds
   - Automatic cleanup of old violations

3. **API Endpoints**
   - `POST /api/csp-violations` - Persist violations (internal)
   - `GET /api/csp-violations/stats` - Get aggregated statistics (admin)
   - `POST /api/csp-violations/refresh-stats` - Refresh materialized view (admin)
   - `GET /api/csp-violations/user/:userId` - Get user violations (admin)

4. **Cron Jobs**
   - Stats refresh every 5 minutes
   - Alert checks every 5 minutes
   - Cleanup old violations daily at 2 AM

5. **Documentation**
   - Complete policy tuning workflow guide
   - Incident response runbook
   - API reference documentation

## Files Created

### Database Migration
- `backend/migrations/022_create_csp_violations.sql`
  - Creates `csp_violations` table with comprehensive violation tracking
  - Creates `csp_violation_stats` materialized view for aggregation
  - Implements RLS policies for security
  - Adds indexes for performance

### Backend Services
- `backend/src/services/csp-monitoring.ts`
  - `persistCspViolation()` - Save violations to database
  - `reportToSentry()` - Send violations to Sentry with context
  - `getCspViolationStats()` - Query aggregated statistics
  - `refreshCspViolationStats()` - Refresh materialized view
  - `checkCspAlerts()` - Check for alert conditions
  - `getUserCspViolations()` - Get violations for specific user
  - `cleanupOldCspViolations()` - Remove old violations (90-day retention)

### API Routes
- `backend/routes/csp-violations.js`
  - POST endpoint for persisting violations
  - GET endpoints for querying statistics
  - Admin authentication required
  - Request validation with Zod

### Cron Jobs
- `backend/src/jobs/csp-monitoring-job.ts`
  - Stats refresh job (every 5 minutes)
  - Alert check job (every 5 minutes)
  - Cleanup job (daily at 2 AM)
  - Start/stop functions for graceful shutdown

### Documentation
- `docs/CSP_POLICY_TUNING.md`
  - Complete workflow from report-only to enforcement
  - Architecture diagrams
  - API reference
  - Troubleshooting guide
  - Best practices

- `docs/CSP_INCIDENT_RESPONSE.md`
  - Alert type definitions
  - Initial response procedures
  - Investigation workflows
  - Resolution procedures
  - Post-incident actions
  - Quick reference commands

## Files Modified

### Client-Side
- `client/app/api/csp-report/route.ts`
  - Removed TODO comments
  - Added database persistence via backend API
  - Added Sentry integration
  - Enhanced logging with request context
  - Non-blocking async processing

### Backend
- `backend/src/index.ts`
  - Registered CSP violations routes
  - Started CSP monitoring cron jobs
  - Added graceful shutdown for cron jobs

- `backend/.env.example`
  - Added CSP monitoring configuration variables
  - Documented alert thresholds

## Features Implemented

### 1. Violation Persistence
- All CSP violations are stored in PostgreSQL/Supabase
- Captures full violation context (directive, URI, source file, line number)
- Stores request context (user agent, IP address, referer)
- Links violations to users when authenticated
- Computed violation signature for grouping

### 2. Real-Time Monitoring (Sentry)
- All violations sent to Sentry with appropriate severity
- Tagged for easy filtering (directive, disposition, blocked URI)
- Includes full context for debugging
- User information attached when available

### 3. Aggregation & Statistics
- Materialized view for fast aggregated queries
- Tracks occurrence count, affected users, affected IPs
- Time-based metrics (first seen, last seen, 24h count, 1h count)
- Refreshed every 5 minutes via cron job

### 4. Alerting System
Three types of alerts:

**High Rate Alert**
- Triggers when violations exceed 100/hour for a single type
- Configurable via `CSP_ALERT_HOURLY_RATE`
- Sent to Sentry with error level

**High User Impact Alert**
- Triggers when violations affect >50 unique users
- Configurable via `CSP_ALERT_AFFECTED_USERS`
- Sent to Sentry with error level

**New Violation Alert**
- Triggers for first occurrence within 5 minutes
- Helps detect new issues quickly
- Sent to Sentry with warning level

### 5. Data Management
- Automatic cleanup of violations older than 90 days
- Configurable retention period
- Runs daily at 2 AM
- Logs cleanup statistics

### 6. Admin API
- Query violation statistics with filtering
- Get violations for specific users
- Manually refresh statistics
- All endpoints require admin authentication

## Configuration

### Environment Variables

```bash
# Enable/disable CSP monitoring
CSP_MONITORING_ENABLED=true

# Alert thresholds
CSP_ALERT_HOURLY_RATE=100
CSP_ALERT_AFFECTED_USERS=50

# Sentry (required for alerting)
SENTRY_DSN=your_sentry_dsn_here
```

### Database Setup

Run the migration:
```bash
cd backend
npm run db:migrate
```

Or manually apply:
```bash
psql $DATABASE_URL -f migrations/022_create_csp_violations.sql
```

## Usage Examples

### Query Top Violations
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/stats?limit=20" | jq
```

### Get Violations for User
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/user/{userId}?limit=50" | jq
```

### Manually Refresh Stats
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
```

## Testing

### Manual Testing

1. **Trigger a CSP violation**:
   ```html
   <!-- Add to a page to trigger violation -->
   <script src="https://evil.com/script.js"></script>
   ```

2. **Check console logs**:
   - Should see violation logged in Next.js console
   - Should see persistence logged in backend console

3. **Check database**:
   ```sql
   SELECT * FROM csp_violations ORDER BY created_at DESC LIMIT 10;
   ```

4. **Check Sentry**:
   - Navigate to Sentry dashboard
   - Filter by tag: `csp_directive`
   - Should see violation event

5. **Check statistics**:
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://localhost:3001/api/csp-violations/stats"
   ```

### Integration Testing

1. **Test alert thresholds**:
   - Generate >100 violations in an hour
   - Check Sentry for high rate alert

2. **Test stats refresh**:
   - Wait 5 minutes for cron job
   - Verify materialized view is updated

3. **Test cleanup**:
   - Insert old test violations
   - Run cleanup job manually
   - Verify old violations are deleted

## Performance Considerations

### Database
- Indexes on frequently queried columns
- Materialized view for aggregation (avoids expensive GROUP BY)
- Automatic cleanup prevents unbounded growth
- Connection pool tracking for monitoring

### API
- Non-blocking violation processing (Promise.all)
- Browser doesn't wait for persistence
- Async Sentry reporting
- Rate limiting on admin endpoints

### Cron Jobs
- Lightweight operations (5-minute intervals)
- Concurrent materialized view refresh
- Configurable via environment variables
- Can be disabled if needed

## Security Considerations

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
- PII redaction in logs (via existing logger)
- 90-day retention policy

## Monitoring & Observability

### Metrics Available
- Total violations per directive
- Violations per hour/day
- Unique users affected
- Unique IPs affected
- First/last seen timestamps

### Logs
- All violations logged to console
- Persistence success/failure logged
- Cron job execution logged
- Alert triggers logged

### Sentry Integration
- Real-time violation events
- Alert notifications
- Context for debugging
- User tracking

## Future Enhancements

### Potential Improvements
1. **Dashboard UI**: Admin panel for viewing violations
2. **Automated Policy Tuning**: Suggest CSP policy changes based on patterns
3. **Machine Learning**: Detect anomalous violation patterns
4. **Webhook Integration**: Send alerts to Slack/Discord
5. **Violation Replay**: Reproduce violations in test environment
6. **Geographic Analysis**: Map violations by location
7. **Browser Analytics**: Track violations by browser/version
8. **Custom Alert Rules**: User-defined alert conditions

### Scalability Considerations
1. **Partitioning**: Partition violations table by date for large volumes
2. **Archiving**: Move old violations to cold storage
3. **Sampling**: Sample violations at high volumes
4. **Distributed Processing**: Use message queue for violation processing

## Acceptance Criteria Status

✅ **CSP reports are queryable outside runtime logs**
- Violations stored in PostgreSQL database
- Admin API endpoints for querying
- SQL queries available for analysis

✅ **Alerts can be triggered for spikes**
- Three alert types implemented
- Configurable thresholds
- Sentry integration for notifications
- Cron job checks every 5 minutes

✅ **Runbook documents response process**
- Complete incident response runbook created
- Step-by-step procedures for each alert type
- Investigation workflows documented
- Resolution procedures provided
- Post-incident actions defined

## Deployment Checklist

- [ ] Run database migration
- [ ] Set environment variables
- [ ] Configure Sentry DSN
- [ ] Deploy backend changes
- [ ] Deploy frontend changes
- [ ] Verify cron jobs are running
- [ ] Test violation persistence
- [ ] Test alert thresholds
- [ ] Review documentation with team
- [ ] Train team on incident response

## Related Issues

- Issue #498: Persist and monitor CSP violation reports

## References

- [CSP Specification](https://www.w3.org/TR/CSP3/)
- [MDN CSP Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Sentry CSP Monitoring](https://docs.sentry.io/product/security-policy-reporting/)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
