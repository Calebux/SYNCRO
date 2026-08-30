# CSP Incident Response Runbook

This runbook provides step-by-step procedures for responding to Content Security Policy (CSP) violation alerts.

## Table of Contents

1. [Alert Types](#alert-types)
2. [Initial Response](#initial-response)
3. [Investigation Procedures](#investigation-procedures)
4. [Resolution Workflows](#resolution-workflows)
5. [Post-Incident Actions](#post-incident-actions)

## Alert Types

### 1. High Rate Alert

**Trigger**: More than 100 violations/hour for a single violation type

**Severity**: High

**Example Sentry Alert**:
```
High CSP violation rate: script-src (150 violations in last hour)
```

### 2. High User Impact Alert

**Trigger**: More than 50 unique users affected by a violation

**Severity**: High

**Example Sentry Alert**:
```
CSP violation affecting many users: script-src (75 users)
```

### 3. New Violation Alert

**Trigger**: First occurrence of a violation type within last 5 minutes

**Severity**: Medium

**Example Sentry Alert**:
```
New CSP violation detected: script-src
```

## Initial Response

### Step 1: Acknowledge Alert (< 5 minutes)

1. **Acknowledge in Sentry** to prevent duplicate notifications
2. **Check alert details**:
   - Violation signature
   - Affected directive
   - Blocked URI
   - Number of occurrences
   - Number of affected users

### Step 2: Assess Severity (< 10 minutes)

Use this decision tree:

```
Is this a new violation type?
├─ YES: Is it from a known/trusted source?
│  ├─ YES: Likely legitimate → Proceed to Investigation
│  └─ NO: Potential attack → Escalate to Security Team
└─ NO: Is the rate significantly higher than baseline?
   ├─ YES: Potential attack or service issue → Escalate
   └─ NO: Known issue → Proceed to Investigation
```

**Escalation Criteria**:
- Unknown/suspicious blocked URI
- Sudden spike (>10x baseline)
- Multiple violation types simultaneously
- Violations from production environment in enforce mode

### Step 3: Initial Triage (< 15 minutes)

1. **Check Sentry context** for:
   - User agent patterns
   - IP address patterns
   - Affected pages
   - Time distribution

2. **Query violation stats**:
   ```bash
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://localhost:3001/api/csp-violations/stats?limit=50" | jq
   ```

3. **Check recent deployments**:
   - Was there a recent code change?
   - Was a new third-party service added?
   - Was the CSP policy modified?

## Investigation Procedures

### Procedure A: Analyze Violation Pattern

**Purpose**: Understand the nature and scope of violations

**Steps**:

1. **Get detailed statistics**:
   ```bash
   # Get violations for specific directive
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://localhost:3001/api/csp-violations/stats?directive=script-src&limit=100" | jq
   ```

2. **Identify patterns**:
   ```sql
   -- Run in database console
   SELECT 
     blocked_uri,
     COUNT(*) as count,
     COUNT(DISTINCT user_id) as unique_users,
     COUNT(DISTINCT ip_address) as unique_ips,
     MIN(created_at) as first_seen,
     MAX(created_at) as last_seen
   FROM csp_violations
   WHERE violated_directive = 'script-src'
     AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY blocked_uri
   ORDER BY count DESC
   LIMIT 20;
   ```

3. **Check user agents**:
   ```sql
   -- Identify if specific browsers/extensions are causing violations
   SELECT 
     user_agent,
     COUNT(*) as count
   FROM csp_violations
   WHERE violated_directive = 'script-src'
     AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY user_agent
   ORDER BY count DESC
   LIMIT 10;
   ```

4. **Analyze temporal distribution**:
   ```sql
   -- Check if violations are continuous or sporadic
   SELECT 
     DATE_TRUNC('hour', created_at) as hour,
     COUNT(*) as count
   FROM csp_violations
   WHERE violated_directive = 'script-src'
     AND created_at > NOW() - INTERVAL '24 hours'
   GROUP BY hour
   ORDER BY hour DESC;
   ```

### Procedure B: Identify Root Cause

**Purpose**: Determine why violations are occurring

**Common Root Causes**:

1. **Browser Extension**
   - **Indicators**: Specific user agent patterns, consistent blocked URI
   - **Example**: Ad blockers, password managers, accessibility tools
   - **Action**: Document for users, consider adding to allowlist if safe

2. **Legitimate Third-Party Service**
   - **Indicators**: Known domain, consistent pattern, affects all users
   - **Example**: Analytics, CDN, payment processor
   - **Action**: Add to CSP policy allowlist

3. **Development/Staging Artifact**
   - **Indicators**: Only in non-production environments
   - **Example**: Hot reload scripts, debug tools
   - **Action**: Update CSP policy for development environment

4. **Code Injection Attack**
   - **Indicators**: Unknown domain, suspicious patterns, sudden spike
   - **Example**: XSS attempt, malicious script injection
   - **Action**: Escalate to security team, investigate further

5. **Inline Script/Style**
   - **Indicators**: blocked_uri is null or 'inline'
   - **Example**: Inline event handlers, inline styles
   - **Action**: Refactor code to use external files or nonces

### Procedure C: Validate Blocked URI

**Purpose**: Determine if blocked URI is legitimate or malicious

**Steps**:

1. **Check domain reputation**:
   ```bash
   # Use VirusTotal, URLhaus, or similar service
   curl "https://www.virustotal.com/api/v3/domains/{domain}" \
     -H "x-apikey: $VT_API_KEY"
   ```

2. **Review domain ownership**:
   - WHOIS lookup
   - Check if domain belongs to known service provider
   - Verify SSL certificate

3. **Check internal documentation**:
   - Is this domain in our approved third-party list?
   - Was this domain recently added by a team member?

4. **Test in isolated environment**:
   - Load the blocked resource in a sandbox
   - Analyze the content
   - Check for malicious behavior

## Resolution Workflows

### Workflow 1: Legitimate Third-Party Service

**Scenario**: Violations from a known, trusted third-party service

**Steps**:

1. **Verify service is necessary**:
   - Confirm with product/engineering team
   - Check if service is actively used

2. **Update CSP policy**:
   ```typescript
   // In client/middleware.ts
   const cspHeader = `
     default-src 'self';
     script-src 'self' https://trusted-cdn.example.com;
     ...
   `;
   ```

3. **Test changes**:
   ```bash
   # Deploy to staging
   # Verify violations stop
   # Monitor for 24 hours
   ```

4. **Deploy to production**:
   ```bash
   # Create PR with CSP changes
   # Get approval from security team
   # Deploy during low-traffic period
   ```

5. **Monitor post-deployment**:
   - Check violation stats after 1 hour
   - Verify violations have stopped
   - Monitor for new violations

### Workflow 2: Browser Extension

**Scenario**: Violations caused by user browser extensions

**Steps**:

1. **Document the extension**:
   - Identify which extension is causing violations
   - Determine if it's a common extension (e.g., LastPass, Grammarly)

2. **Evaluate options**:
   - **Option A**: Add to allowlist if extension is safe and common
   - **Option B**: Document in user help center that extension may cause issues
   - **Option C**: Do nothing if violations are minimal

3. **If adding to allowlist**:
   ```typescript
   // In client/middleware.ts
   const cspHeader = `
     default-src 'self';
     script-src 'self' https://extension-domain.com;
     ...
   `;
   ```

4. **Update documentation**:
   - Add to list of supported extensions
   - Document any known issues

### Workflow 3: Code Injection Attack

**Scenario**: Violations indicate potential security attack

**Steps**:

1. **Immediate actions** (< 30 minutes):
   - Escalate to security team
   - Enable CSP enforcement if not already enabled
   - Consider rate limiting affected endpoints
   - Review recent access logs

2. **Investigation** (< 2 hours):
   - Identify attack vector (XSS, SQL injection, etc.)
   - Check for compromised accounts
   - Review recent code changes
   - Scan for malware/backdoors

3. **Containment** (< 4 hours):
   - Block malicious IPs at firewall level
   - Patch vulnerable code
   - Revoke compromised credentials
   - Deploy security fixes

4. **Recovery** (< 24 hours):
   - Verify attack has stopped
   - Monitor for continued attempts
   - Review and strengthen security controls
   - Conduct post-incident review

### Workflow 4: Inline Script/Style

**Scenario**: Violations from inline scripts or styles in our code

**Steps**:

1. **Identify source**:
   ```sql
   SELECT 
     source_file,
     line_number,
     COUNT(*) as count
   FROM csp_violations
   WHERE blocked_uri IS NULL OR blocked_uri = 'inline'
   GROUP BY source_file, line_number
   ORDER BY count DESC;
   ```

2. **Refactor code**:
   - **Option A**: Move to external file
   - **Option B**: Use nonce for inline scripts
   - **Option C**: Use hash for static inline content

3. **Example with nonce**:
   ```typescript
   // Generate nonce in middleware
   const nonce = crypto.randomBytes(16).toString('base64');
   
   // Add to CSP header
   const cspHeader = `
     script-src 'self' 'nonce-${nonce}';
   `;
   
   // Use in HTML
   <script nonce="${nonce}">
     // Inline script here
   </script>
   ```

4. **Test and deploy**:
   - Verify violations stop
   - Deploy to production
   - Monitor for 24 hours

## Post-Incident Actions

### 1. Update Documentation (< 24 hours)

- Document the incident in incident log
- Update CSP policy documentation
- Add to known issues if applicable
- Update runbook if new procedures were discovered

### 2. Review and Improve (< 1 week)

- Conduct post-incident review meeting
- Identify what went well and what didn't
- Update alert thresholds if needed
- Improve monitoring and detection

### 3. Preventive Measures (< 2 weeks)

- Implement additional security controls
- Update development guidelines
- Conduct security training if needed
- Review and update CSP policy

### 4. Metrics and Reporting (< 1 month)

- Track incident metrics:
  - Time to detect
  - Time to acknowledge
  - Time to resolve
  - Impact (users affected, duration)
- Report to stakeholders
- Update security dashboard

## Quick Reference

### Useful Commands

```bash
# Get top violations
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/stats?limit=20" | jq

# Refresh stats manually
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/refresh-stats"

# Get violations for specific user
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/csp-violations/user/{userId}" | jq

# Check Sentry for violations
open "https://sentry.io/organizations/{org}/issues/?query=csp"
```

### Useful SQL Queries

```sql
-- Top violations in last 24 hours
SELECT * FROM csp_violation_stats 
WHERE count_24h > 0 
ORDER BY count_24h DESC 
LIMIT 20;

-- New violations in last hour
SELECT * FROM csp_violations 
WHERE created_at > NOW() - INTERVAL '1 hour' 
ORDER BY created_at DESC;

-- Violations by user
SELECT user_id, COUNT(*) as count 
FROM csp_violations 
WHERE user_id IS NOT NULL 
GROUP BY user_id 
ORDER BY count DESC 
LIMIT 20;
```

### Contact Information

- **Security Team**: security@example.com
- **On-Call Engineer**: Use PagerDuty
- **Sentry Dashboard**: https://sentry.io/organizations/{org}
- **Status Page**: https://status.example.com

## Appendix: CSP Directives Reference

| Directive | Purpose | Example |
|-----------|---------|---------|
| `default-src` | Fallback for other directives | `'self'` |
| `script-src` | JavaScript sources | `'self' https://cdn.example.com` |
| `style-src` | CSS sources | `'self' 'unsafe-inline'` |
| `img-src` | Image sources | `'self' data: https:` |
| `font-src` | Font sources | `'self' https://fonts.gstatic.com` |
| `connect-src` | AJAX, WebSocket sources | `'self' https://api.example.com` |
| `frame-src` | iframe sources | `'self' https://youtube.com` |
| `media-src` | Audio/video sources | `'self' https://media.example.com` |
| `object-src` | Plugin sources | `'none'` |
| `base-uri` | Base tag sources | `'self'` |
| `form-action` | Form submission targets | `'self'` |
| `frame-ancestors` | Embedding sources | `'none'` |
