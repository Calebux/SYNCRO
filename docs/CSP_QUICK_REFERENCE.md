# CSP Monitoring Quick Reference Card

## 🚀 Quick Start

```bash
# 1. Run migration
cd backend && npm run db:migrate

# 2. Set environment variables
CSP_MONITORING_ENABLED=true
CSP_ALERT_HOURLY_RATE=100
CSP_ALERT_AFFECTED_USERS=50
SENTRY_DSN=your_sentry_dsn

# 3. Test setup
node test-csp-monitoring.js

# 4. Start server
npm run dev
```

## 📊 Common Queries

### Top Violations (Last 24h)
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/stats?limit=20" | jq
```

### User Violations
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/user/{userId}" | jq
```

### Refresh Stats
```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/refresh-stats"
```

## 🗄️ SQL Queries

### Top Violations
```sql
SELECT * FROM csp_violation_stats 
WHERE count_24h > 0 
ORDER BY count_24h DESC 
LIMIT 20;
```

### Recent Violations
```sql
SELECT * FROM csp_violations 
WHERE created_at > NOW() - INTERVAL '1 hour' 
ORDER BY created_at DESC;
```

### Violations by Directive
```sql
SELECT 
  violated_directive,
  COUNT(*) as count,
  COUNT(DISTINCT user_id) as users
FROM csp_violations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY violated_directive
ORDER BY count DESC;
```

## 🚨 Alert Types

| Alert | Threshold | Level | Action |
|-------|-----------|-------|--------|
| High Rate | >100/hour | Error | Investigate immediately |
| High Impact | >50 users | Error | Check for widespread issue |
| New Violation | First seen | Warning | Review and categorize |

## 🔧 Troubleshooting

### No Violations Stored
```bash
# Check table exists
psql $DATABASE_URL -c "SELECT COUNT(*) FROM csp_violations;"

# Check backend logs
tail -f logs/combined-*.log | grep "CSP violation"

# Test endpoint
curl -X POST http://localhost:3000/api/csp-report \
  -H "Content-Type: application/json" \
  -d '{"csp-report":{"document-uri":"https://example.com","violated-directive":"script-src"}}'
```

### Stats Not Updating
```bash
# Check cron logs
tail -f logs/combined-*.log | grep "CSP stats"

# Manual refresh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/csp-violations/refresh-stats

# Check view
psql $DATABASE_URL -c "SELECT COUNT(*) FROM csp_violation_stats;"
```

### No Alerts
```bash
# Check Sentry config
echo $SENTRY_DSN

# Check violation counts
psql $DATABASE_URL -c "SELECT * FROM csp_violation_stats WHERE count_1h > 0;"

# Check alert logs
tail -f logs/combined-*.log | grep "CSP alert"
```

## 📝 Common Tasks

### Add Domain to Allowlist
```typescript
// In client/middleware.ts
const cspHeader = `
  script-src 'self' https://trusted-domain.com;
`;
```

### Disable Monitoring
```bash
# In .env
CSP_MONITORING_ENABLED=false
```

### Change Alert Thresholds
```bash
# In .env
CSP_ALERT_HOURLY_RATE=200
CSP_ALERT_AFFECTED_USERS=100
```

### Manual Cleanup
```sql
DELETE FROM csp_violations 
WHERE created_at < NOW() - INTERVAL '90 days';
```

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [CSP Monitoring README](./CSP_MONITORING_README.md) | Quick start guide |
| [Policy Tuning Workflow](./CSP_POLICY_TUNING.md) | Complete workflow |
| [Incident Response](./CSP_INCIDENT_RESPONSE.md) | Response procedures |
| [Implementation Summary](../ISSUE_498_IMPLEMENTATION_SUMMARY.md) | Technical details |

## 🔗 Useful Links

- **Sentry Dashboard**: https://sentry.io/organizations/{org}
- **Database Console**: Your Supabase/PostgreSQL console
- **API Docs**: http://localhost:3001/api/docs

## 📞 Contacts

- **Security Team**: security@example.com
- **On-Call**: Use PagerDuty
- **Status Page**: https://status.example.com

## 🎯 CSP Directives

| Directive | Purpose | Example |
|-----------|---------|---------|
| `script-src` | JavaScript | `'self' https://cdn.com` |
| `style-src` | CSS | `'self' 'unsafe-inline'` |
| `img-src` | Images | `'self' data: https:` |
| `connect-src` | AJAX/WS | `'self' https://api.com` |
| `font-src` | Fonts | `'self' https://fonts.com` |
| `frame-src` | iframes | `'self' https://youtube.com` |

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CSP_MONITORING_ENABLED` | `true` | Enable monitoring |
| `CSP_ALERT_HOURLY_RATE` | `100` | Violations/hour threshold |
| `CSP_ALERT_AFFECTED_USERS` | `50` | Users affected threshold |

## 🕐 Cron Schedule

| Job | Schedule | Purpose |
|-----|----------|---------|
| Stats Refresh | */5 * * * * | Update materialized view |
| Alert Check | */5 * * * * | Check alert conditions |
| Cleanup | 0 2 * * * | Remove old violations |

---

**Print this card and keep it handy!** 📋
