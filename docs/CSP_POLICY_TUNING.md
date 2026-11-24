# CSP Policy Tuning Workflow

This document describes the complete workflow for tuning Content Security Policy (CSP) violations, from report-only mode to enforcement.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Monitoring & Alerting](#monitoring--alerting)
4. [Policy Tuning Process](#policy-tuning-process)
5. [API Reference](#api-reference)
6. [Alert Thresholds](#alert-thresholds)
7. [Troubleshooting](#troubleshooting)

## Overview

Content Security Policy (CSP) is a security standard that helps prevent cross-site scripting (XSS), clickjacking, and other code injection attacks. Our implementation follows a phased approach:

1. **Report-Only Mode**: CSP violations are reported but not blocked
2. **Analysis Phase**: Violations are monitored, aggregated, and analyzed
3. **Tuning Phase**: Policy is adjusted based on violation patterns
4. **Enforcement Mode**: CSP violations are blocked

## Architecture

### Components

```
┌─────────────────┐
│   Browser       │
│  (CSP Report)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js API Route                                      │
│  /api/csp-report                                        │
│  - Validates report format                              │
│  - Logs to console                                      │
│  - Forwards to backend                                  │
│  - Sends to Sentry (if configured)                      │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Backend API                                            │
│  /api/csp-violations                                    │
│  - Persists to database                                 │
│  - Sends to Sentry with context                         │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Database (PostgreSQL/Supabase)                         │
│  - csp_violations table (raw violations)                │
│  - csp_violation_stats view (aggregated stats)          │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Monitoring Jobs (Cron)                                 │
│  - Refresh stats every 5 minutes                        │
│  - Check alert conditions every 5 minutes               │
│  - Cleanup old violations daily                         │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Alerting (Sentry)                                      │
│  - High violation rate alerts                           │
│  - High user impact alerts                              │
│  - New violation type alerts                            │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Browser** detects CSP violation and sends report to `/api/csp-report`
2. **Next.js API** validates and forwards to backend
3. **Backend** persists to database and sends to Sentry
4. **Cron jobs** aggregate statistics and check for alert conditions
5. **Sentry** notifies team of critical violations

## Monitoring & Alerting

### Real-Time Monitoring (Sentry)

All CSP violations are sent to Sentry with:
- **Level**: `error` for enforce mode, `warning` for report-only mode
- **Tags**: `csp_directive`, `csp_disposition`, `csp_blocked_uri`
- **Context**: Full violation details, request context, user info

### Aggregated Statistics

The `csp_violation_stats` materialized view provides:
- **Occurrence count**: Total number of violations per signature
- **Affected users**: Number of unique users experiencing the violation
- **Affected IPs**: Number of unique IP addresses
- **Time range**: First seen, last seen timestamps
- **Recent activity**: Counts for last 24 hours and last hour

### Alert Conditions

Alerts are triggered when:

1. **High Rate**: More than 100 violations/hour for a single violation type
2. **High User Impact**: More than 50 unique users affected
3. **New Violation**: First occurrence within last 5 minutes

Configure thresholds via environment variables:
```bash
CSP_ALERT_HOURLY_RATE=100
CSP_ALERT_AFFECTED_USERS=50
```

## Policy Tuning Process

### Phase 1: Report-Only Mode (Week 1)

**Goal**: Collect baseline violation data without blocking content

1. **Enable report-only mode** in `client/middleware.ts`:
   ```typescript
   'Content-Security-Policy-Report-Only': cspHeader
   ```

2. **Monitor violations** for 7 days:
   ```bash
   # View top violations
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:3001/api/csp-violations/stats?limit=20
   ```

3. **Analyze patterns**:
   - Which directives are most violated?
   - Are violations from legitimate sources or attacks?
   - Which violations affect the most users?

### Phase 2: Policy Adjustment (Week 2)

**Goal**: Tune CSP policy to eliminate false positives

1. **Review violation statistics**:
   ```sql
   SELECT 
     violated_directive,
     blocked_uri,
     occurrence_count,
     affected_users
   FROM csp_violation_stats
   WHERE occurrence_count > 10
   ORDER BY occurrence_count DESC;
   ```

2. **Categorize violations**:
   - **Legitimate**: Add to CSP allowlist
   - **Third-party**: Evaluate if necessary, add to allowlist or remove integration
   - **Attack**: Keep blocked, monitor for patterns

3. **Update CSP policy** in `client/middleware.ts`:
   ```typescript
   // Example: Allow specific CDN
   "script-src 'self' https://cdn.example.com"
   
   // Example: Allow inline styles with nonce
   "style-src 'self' 'nonce-{NONCE}'"
   ```

4. **Deploy changes** and continue monitoring

### Phase 3: Validation (Week 3)

**Goal**: Verify policy changes resolved violations

1. **Monitor for 7 days** after policy changes

2. **Check for clean reports**:
   ```bash
   # Should show minimal or zero violations
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:3001/api/csp-violations/stats?limit=20
   ```

3. **Review Sentry alerts** - should see significant reduction

### Phase 4: Enforcement (Week 4+)

**Goal**: Enable CSP enforcement to block violations

1. **Switch to enforce mode** in `client/middleware.ts`:
   ```typescript
   // Change from:
   'Content-Security-Policy-Report-Only': cspHeader
   
   // To:
   'Content-Security-Policy': cspHeader
   ```

2. **Deploy to production**

3. **Continue monitoring** for new violations

4. **Iterate** as needed when adding new features

## API Reference

### POST /api/csp-violations

Persist a CSP violation report (internal use only).

**Request**:
```json
{
  "report": {
    "document-uri": "https://example.com/page",
    "violated-directive": "script-src",
    "blocked-uri": "https://evil.com/script.js",
    "source-file": "https://example.com/page",
    "line-number": 42,
    "column-number": 10,
    "disposition": "report"
  },
  "context": {
    "userAgent": "Mozilla/5.0...",
    "ipAddress": "192.168.1.1",
    "referer": "https://example.com/",
    "userId": "uuid-here"
  }
}
```

**Response**:
```json
{
  "success": true
}
```

### GET /api/csp-violations/stats

Get aggregated CSP violation statistics (admin only).

**Query Parameters**:
- `limit` (optional): Maximum results (default: 50)
- `minOccurrences` (optional): Minimum occurrence count (default: 1)
- `directive` (optional): Filter by directive

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "violation_signature": "script-src::https://evil.com/script.js",
      "violated_directive": "script-src",
      "blocked_uri": "https://evil.com/script.js",
      "disposition": "report",
      "occurrence_count": 150,
      "affected_users": 25,
      "affected_ips": 30,
      "first_seen": "2026-04-27T10:00:00Z",
      "last_seen": "2026-04-27T14:30:00Z",
      "count_24h": 150,
      "count_1h": 45
    }
  ],
  "count": 1
}
```

### POST /api/csp-violations/refresh-stats

Refresh the materialized view (admin only).

**Response**:
```json
{
  "success": true,
  "message": "Statistics refreshed successfully"
}
```

### GET /api/csp-violations/user/:userId

Get violations for a specific user (admin only).

**Query Parameters**:
- `limit` (optional): Maximum results (default: 50)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "document_uri": "https://example.com/page",
      "violated_directive": "script-src",
      "blocked_uri": "https://evil.com/script.js",
      "created_at": "2026-04-27T14:30:00Z",
      ...
    }
  ],
  "count": 1
}
```

## Alert Thresholds

Configure via environment variables:

```bash
# Alert if violation occurs more than this many times per hour
CSP_ALERT_HOURLY_RATE=100

# Alert if violation affects more than this many unique users
CSP_ALERT_AFFECTED_USERS=50

# Enable/disable CSP monitoring jobs
CSP_MONITORING_ENABLED=true
```

## Troubleshooting

### High Volume of Violations

**Symptom**: Thousands of violations per hour

**Possible Causes**:
1. Browser extension injecting scripts
2. Legitimate third-party service not in allowlist
3. Actual attack in progress

**Resolution**:
1. Check `blocked_uri` patterns in stats
2. If browser extension: Document for users or add to allowlist
3. If legitimate service: Add to CSP policy
4. If attack: Monitor and consider blocking at firewall level

### No Violations Reported

**Symptom**: Zero violations in database

**Possible Causes**:
1. CSP header not being sent
2. Report endpoint not accessible
3. Browser not supporting CSP reporting

**Resolution**:
1. Check browser DevTools Network tab for CSP header
2. Verify `/api/csp-report` endpoint is accessible
3. Test with modern browser (Chrome, Firefox, Safari)

### Stats Not Updating

**Symptom**: `csp_violation_stats` view shows stale data

**Possible Causes**:
1. Cron job not running
2. Database permissions issue
3. Materialized view refresh failing

**Resolution**:
1. Check backend logs for cron job execution
2. Manually refresh: `POST /api/csp-violations/refresh-stats`
3. Check database logs for errors

### Sentry Not Receiving Violations

**Symptom**: No CSP violations in Sentry dashboard

**Possible Causes**:
1. `NEXT_PUBLIC_SENTRY_DSN` not configured
2. Sentry SDK not initialized
3. Network issue preventing Sentry requests

**Resolution**:
1. Verify environment variable is set
2. Check Sentry configuration in `sentry.*.config.ts`
3. Check browser console for Sentry errors

## Best Practices

1. **Start with report-only mode** - Never enable enforcement without testing
2. **Monitor for at least 1 week** - Capture all user scenarios
3. **Use nonces for inline scripts** - More secure than 'unsafe-inline'
4. **Regularly review violations** - New features may introduce new violations
5. **Document policy decisions** - Keep track of why certain sources are allowed
6. **Set up Sentry alerts** - Get notified of critical violations immediately
7. **Clean up old data** - Retention policy keeps database size manageable

## Related Documentation

- [CSP Specification](https://www.w3.org/TR/CSP3/)
- [MDN CSP Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Sentry CSP Monitoring](https://docs.sentry.io/product/security-policy-reporting/)
