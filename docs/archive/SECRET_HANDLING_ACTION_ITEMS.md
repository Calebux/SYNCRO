# Secret Handling Action Items - Issue #636

**Priority**: P0  
**Status**: Ready for Implementation  
**Related**: SECRET_HANDLING_AUDIT_REPORT.md

## Immediate Actions (P0) - Required for Issue Closure

### 1. Add Documentation Comments for Demo JWT Token

**Files to Update**:
- `scripts/test-rls-audit.js` (line 15-16)
- `.github/workflows/database.yml` (line 52)
- `.github/workflows/rls-audit.yml` (line 56)

**Change Required**:
Add inline comment explaining this is the official Supabase demo token for local development.

**Example**:
```javascript
// Official Supabase demo token for local development
// This token only works with local Supabase instances (http://localhost:54321)
// Issuer: supabase-demo, Expires: 2032-12-31
// NOT a production secret - safe to commit
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
```

**Estimated Time**: 15 minutes

---

### 2. Update SDK Documentation Placeholders

**File to Update**: `sdk/README.md`

**Current Issues**:
- Line 340: `apiKey: "sk_live_abc123xyz"` - looks too real
- Line 356: `apiKey: "sk_live_abc123xyz"` - duplicate
- Line 523: `syncro_subs_sk_live_abc123xyz` - cache key example

**Recommended Changes**:
```typescript
// Before
const sdk = init({
  apiKey: "sk_live_abc123xyz",
  wallet: yourWallet,
});

// After
const sdk = init({
  apiKey: "sk_live_...", // Your Syncro API key
  wallet: yourWallet,
});
```

**Estimated Time**: 10 minutes

---

### 3. Create Secret Rotation Policy Document

**File to Create**: `docs/SECRET_ROTATION_POLICY.md`

**Required Content**:
- Rotation frequency for each secret type
- Rotation procedure checklist
- Emergency rotation process
- Rotation history tracking

**Template**:
```markdown
# Secret Rotation Policy

## Rotation Schedule

| Secret Type | Rotation Frequency | Owner | Notes |
|-------------|-------------------|-------|-------|
| JWT_SECRET | Every 90 days | Backend Team | Requires user re-authentication |
| ADMIN_API_KEY | Every 90 days | Security Team | Critical - protects admin endpoints |
| STRIPE_SECRET_KEY | On compromise only | Finance Team | Managed by Stripe |
| ENCRYPTION_KEY | Every 180 days | Security Team | Requires data re-encryption |
| TELEGRAM_BOT_TOKEN | On compromise only | Backend Team | Managed by Telegram |
| Database Credentials | Every 90 days | DevOps Team | Coordinate with deployments |

## Rotation Procedure

### Standard Rotation
1. Generate new secret value
2. Update secret in secret manager (GitHub Secrets, AWS Secrets Manager, etc.)
3. Deploy updated configuration
4. Verify service functionality
5. Revoke old secret after grace period (24-48 hours)
6. Document rotation in SECURITY_AUDIT_MATRIX_API_ROUTES.md

### Emergency Rotation (Compromise Detected)
1. Immediately revoke compromised secret
2. Generate new secret value
3. Emergency deployment
4. Verify service functionality
5. Incident report and post-mortem
6. Update security documentation

## Rotation History

Track all rotations in `SECURITY_AUDIT_MATRIX_API_ROUTES.md` under "Rotation History" section.

## Automation

- [ ] Set up automated rotation reminders (90 days before expiration)
- [ ] Create rotation scripts for common secrets
- [ ] Implement secret expiration monitoring
```

**Estimated Time**: 30 minutes

---

### 4. Verify GitHub Secrets Configuration

**Action Required**: Audit all GitHub Actions secrets

**Checklist**:
- [ ] `SUPABASE_URL` - Set for production
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - Set for production
- [ ] `STRIPE_SECRET_KEY` - Set for production
- [ ] `STRIPE_WEBHOOK_SECRET` - Set for production
- [ ] `JWT_SECRET` - Set for production
- [ ] `ADMIN_API_KEY` - Set for production
- [ ] `ENCRYPTION_KEY` - Set for production
- [ ] `TELEGRAM_BOT_TOKEN` - Set for production (if used)
- [ ] `GOOGLE_CLIENT_SECRET` - Set if Gmail integration enabled
- [ ] `MICROSOFT_CLIENT_SECRET` - Set if Outlook integration enabled

**Verification Steps**:
1. Go to GitHub repository settings
2. Navigate to Secrets and variables → Actions
3. Verify all required secrets are set
4. Check secret permissions (read/write access)
5. Verify environment-specific secrets (staging, production)

**Estimated Time**: 20 minutes

---

## Short-Term Actions (P1) - Recommended

### 5. Implement Secret Rotation Automation

**Tasks**:
- Create rotation reminder script
- Add rotation tracking to CI/CD
- Automate rotation notifications

**Files to Create**:
- `scripts/check-secret-expiration.js`
- `.github/workflows/secret-rotation-reminder.yml`

**Example Script**:
```javascript
// scripts/check-secret-expiration.js
const ROTATION_SCHEDULE = {
  JWT_SECRET: 90, // days
  ADMIN_API_KEY: 90,
  ENCRYPTION_KEY: 180,
};

const LAST_ROTATION = {
  JWT_SECRET: '2026-03-01',
  ADMIN_API_KEY: '2026-03-01',
  ENCRYPTION_KEY: '2025-12-01',
};

function checkExpiration() {
  const today = new Date();
  const warnings = [];

  for (const [secret, days] of Object.entries(ROTATION_SCHEDULE)) {
    const lastRotation = new Date(LAST_ROTATION[secret]);
    const daysSinceRotation = Math.floor((today - lastRotation) / (1000 * 60 * 60 * 24));
    const daysUntilRotation = days - daysSinceRotation;

    if (daysUntilRotation <= 14) {
      warnings.push(`⚠️ ${secret} should be rotated in ${daysUntilRotation} days`);
    }
  }

  if (warnings.length > 0) {
    console.log('🔐 Secret Rotation Warnings:');
    warnings.forEach(w => console.log(w));
    process.exit(1); // Fail CI to alert team
  } else {
    console.log('✅ All secrets are within rotation schedule');
  }
}

checkExpiration();
```

**Estimated Time**: 2 hours

---

### 6. Enhance Secret Provider with AWS Secrets Manager

**File to Update**: `backend/src/services/secret-provider.ts`

**Implementation**:
```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export class AwsSecretProvider implements SecretProvider {
  private client: SecretsManagerClient;
  private cache: Map<string, { value: string; expiry: number }>;
  private cacheTTL: number = 300000; // 5 minutes

  constructor() {
    this.client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.cache = new Map();
  }

  async getSecret(key: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.value;
    }

    try {
      const command = new GetSecretValueCommand({
        SecretId: key,
      });
      const response = await this.client.send(command);
      const value = response.SecretString;

      // Cache the value
      if (value) {
        this.cache.set(key, {
          value,
          expiry: Date.now() + this.cacheTTL,
        });
      }

      return value;
    } catch (error) {
      console.error(`Failed to retrieve secret ${key} from AWS:`, error);
      return undefined;
    }
  }
}

// Update factory
export class SecretProviderFactory {
  static getProvider(): SecretProvider {
    if (!this.instance) {
      const type = process.env.SECRET_PROVIDER_TYPE || 'local';
      
      switch (type.toLowerCase()) {
        case 'local':
          this.instance = new LocalSecretProvider();
          break;
        case 'aws':
          this.instance = new AwsSecretProvider();
          break;
        default:
          console.warn(`Unknown SecretProvider type: ${type}. Falling back to 'local'.`);
          this.instance = new LocalSecretProvider();
      }
    }
    return this.instance;
  }
}
```

**Dependencies to Add**:
```bash
npm install @aws-sdk/client-secrets-manager
```

**Estimated Time**: 3 hours

---

### 7. Add Secret Access Monitoring

**File to Create**: `backend/src/middleware/secret-access-logger.ts`

**Implementation**:
```typescript
import logger from '../config/logger';

export class SecretAccessMonitor {
  private static accessLog: Map<string, number[]> = new Map();
  private static readonly ALERT_THRESHOLD = 100; // requests per minute
  private static readonly WINDOW_MS = 60000; // 1 minute

  static logAccess(secretKey: string, success: boolean): void {
    const now = Date.now();
    
    // Log access (without secret value)
    logger.info('Secret access', {
      key: secretKey,
      success,
      timestamp: now,
    });

    // Track access rate
    if (!this.accessLog.has(secretKey)) {
      this.accessLog.set(secretKey, []);
    }

    const accesses = this.accessLog.get(secretKey)!;
    accesses.push(now);

    // Remove old entries outside the window
    const cutoff = now - this.WINDOW_MS;
    const recentAccesses = accesses.filter(t => t > cutoff);
    this.accessLog.set(secretKey, recentAccesses);

    // Alert if threshold exceeded
    if (recentAccesses.length > this.ALERT_THRESHOLD) {
      logger.warn('High secret access rate detected', {
        key: secretKey,
        count: recentAccesses.length,
        window: `${this.WINDOW_MS}ms`,
      });
    }
  }

  static logFailure(secretKey: string, error: Error): void {
    logger.error('Secret retrieval failed', {
      key: secretKey,
      error: error.message,
    });
    this.logAccess(secretKey, false);
  }
}

// Update SecretProvider to use monitoring
export class LocalSecretProvider implements SecretProvider {
  async getSecret(key: string): Promise<string | undefined> {
    try {
      const value = process.env[key];
      SecretAccessMonitor.logAccess(key, !!value);
      return value;
    } catch (error) {
      SecretAccessMonitor.logFailure(key, error as Error);
      return undefined;
    }
  }
}
```

**Estimated Time**: 2 hours

---

## Long-Term Actions (P2) - Future Enhancements

### 8. Implement Pre-Commit Secret Scanning

**Tools to Integrate**:
- `truffleHog` - Secret scanning
- `git-secrets` - AWS secret prevention
- `detect-secrets` - Yelp's secret scanner

**Implementation**:
```bash
# Install pre-commit hooks
npm install --save-dev @commitlint/cli husky

# Add to package.json
{
  "scripts": {
    "prepare": "husky install",
    "scan-secrets": "trufflehog filesystem . --json --fail"
  }
}

# Create .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

echo "🔍 Scanning for secrets..."
npm run scan-secrets

if [ $? -ne 0 ]; then
  echo "❌ Secret detected! Commit blocked."
  exit 1
fi
```

**Estimated Time**: 4 hours

---

### 9. Implement Secret Audit Trail

**Database Schema**:
```sql
CREATE TABLE secret_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_key TEXT NOT NULL,
  access_type TEXT NOT NULL, -- 'read', 'write', 'rotate'
  success BOOLEAN NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_secret_access_logs_key ON secret_access_logs(secret_key);
CREATE INDEX idx_secret_access_logs_created_at ON secret_access_logs(created_at DESC);
```

**Estimated Time**: 6 hours

---

### 10. Implement Zero-Trust Secret Management

**Features**:
- Short-lived credentials (1-hour expiry)
- Automatic rotation
- Service-specific credentials
- Least-privilege access

**Architecture**:
```typescript
interface ShortLivedCredential {
  value: string;
  expiresAt: Date;
  rotateAt: Date;
}

class ZeroTrustSecretProvider implements SecretProvider {
  async getSecret(key: string): Promise<string | undefined> {
    const credential = await this.getOrRefreshCredential(key);
    return credential?.value;
  }

  private async getOrRefreshCredential(key: string): Promise<ShortLivedCredential | undefined> {
    // Check if credential needs rotation
    // Request new credential from secret manager
    // Cache with short TTL
    // Return credential
  }
}
```

**Estimated Time**: 2 weeks

---

## Testing Requirements

### Test Coverage for P0 Actions

1. **Demo Token Documentation**
   - Manual verification: Comments are clear and accurate

2. **SDK Documentation**
   - Manual verification: Placeholders are clearly fake

3. **Secret Rotation Policy**
   - Manual verification: Policy is comprehensive and actionable

4. **GitHub Secrets**
   - Manual verification: All secrets are set and accessible

### Test Coverage for P1 Actions

1. **Secret Rotation Automation**
   - Unit tests for expiration calculation
   - Integration tests for notification system

2. **AWS Secrets Manager**
   - Unit tests for AwsSecretProvider
   - Integration tests with AWS (mocked)
   - Cache behavior tests

3. **Secret Access Monitoring**
   - Unit tests for access logging
   - Unit tests for rate limiting
   - Integration tests for alerting

---

## Success Criteria

### P0 Actions (Required for Issue Closure)
- [ ] All demo JWT tokens have clarifying comments
- [ ] SDK documentation uses clear placeholders
- [ ] Secret rotation policy document created
- [ ] GitHub secrets verified and documented

### P1 Actions (Recommended)
- [ ] Secret rotation automation implemented
- [ ] AWS Secrets Manager provider implemented
- [ ] Secret access monitoring implemented
- [ ] All tests passing

### P2 Actions (Future)
- [ ] Pre-commit secret scanning enabled
- [ ] Secret audit trail implemented
- [ ] Zero-trust secret management designed

---

## Timeline

| Action | Priority | Estimated Time | Dependencies |
|--------|----------|----------------|--------------|
| 1. Demo token comments | P0 | 15 min | None |
| 2. SDK documentation | P0 | 10 min | None |
| 3. Rotation policy | P0 | 30 min | None |
| 4. Verify GitHub secrets | P0 | 20 min | None |
| 5. Rotation automation | P1 | 2 hours | Action 3 |
| 6. AWS Secrets Manager | P1 | 3 hours | None |
| 7. Access monitoring | P1 | 2 hours | None |
| 8. Pre-commit scanning | P2 | 4 hours | None |
| 9. Audit trail | P2 | 6 hours | None |
| 10. Zero-trust | P2 | 2 weeks | Actions 6, 7, 9 |

**Total P0 Time**: ~1.5 hours  
**Total P1 Time**: ~7 hours  
**Total P2 Time**: ~2.5 weeks

---

## Next Steps

1. Review this action plan with the team
2. Assign owners for each action
3. Create GitHub issues for P1 and P2 actions
4. Implement P0 actions immediately
5. Schedule P1 actions for next sprint
6. Plan P2 actions for future roadmap

---

**Document Owner**: Security Team  
**Last Updated**: May 27, 2026  
**Next Review**: After P0 completion
