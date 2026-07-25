# Migration Guide: Adding Privacy to Existing Apps

## Overview

This guide helps you add privacy features to an existing SYNCRO integration without breaking existing functionality.

## Migration Strategy

**Three-Phase Approach**:
1. **Phase 1**: Add privacy features alongside existing plaintext system
2. **Phase 2**: Migrate existing data to encrypted format
3. **Phase 3**: Deprecate and remove plaintext system

**Timeline**: 1-4 weeks depending on data volume

## Phase 1: Add Privacy Infrastructure

### Step 1.1: Update Your Data Model

Add privacy fields to your subscription schema:

```typescript
// Before
interface StoredSubscription {
  id: string;
  userId: string;
  name: string;
  price: number;
  cycle: string;
  provider: string;
}

// After (backwards compatible)
interface StoredSubscription {
  id: string;
  userId: string;
  // Old plaintext fields (keep for now)
  name?: string;
  price?: number;
  cycle?: string;
  provider?: string;
  // New encrypted fields
  encryptedMetadata?: EncryptedData;
  amountCommitment?: string;
  stealthMetaAddress?: string;
  // Migration tracking
  privacyVersion: 1 | 2; // 1 = plaintext, 2 = encrypted
  createdAt: Date;
  migratedAt?: Date;
}
```

### Step 1.2: Add Privacy Keys Storage

```typescript
interface SubscriptionKeys {
  subscriptionId: string;
  userId: string;
  encryptionKey: string;        // Hex-encoded 32 bytes
  blindingFactor: string;       // For commitments
  createdAt: Date;
}

// Store in encrypted database or in-memory cache
// NEVER expose to API responses
```

### Step 1.3: Update API Responses

Return plaintext for now, but prepare for migration:

```typescript
// Existing endpoint (backwards compatible)
app.get('/api/subscriptions/:id', async (req, res) => {
  const subscription = await db.subscription.findById(req.params.id);

  // Return plaintext if exists, else decrypt
  if (subscription.name) {
    return res.json({
      id: subscription.id,
      name: subscription.name,
      price: subscription.price,
      // ... existing fields
    });
  } else if (subscription.encryptedMetadata) {
    // TODO: decrypt for response after migration
    // For now, don't expose encrypted data in API
    return res.status(400).json({ error: 'Subscription not migrated' });
  }
});
```

### Step 1.4: Enable Privacy for New Subscriptions

```typescript
import { encryptSubscriptionMetadata, commit } from '@syncro/sdk';

app.post('/api/subscriptions', async (req, res) => {
  const { name, price, cycle, provider, usePrivacy } = req.body;

  if (usePrivacy) {
    // NEW: Create privacy-enhanced subscription
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    const keyHex = bytesToHex(encryptionKey);

    const encrypted = await encryptSubscriptionMetadata(keyHex, {
      name, price, cycle, provider
    });

    const commitment = commit(BigInt(Math.floor(price * 100)));

    const subscription = await db.subscription.create({
      userId: req.user.id,
      encryptedMetadata: encrypted,
      amountCommitment: commitment.commitment,
      privacyVersion: 2,
      createdAt: new Date()
    });

    // Store key securely (not in DB)
    await keyStore.set(`sub-${subscription.id}`, keyHex);

    return res.json(subscription);
  } else {
    // OLD: Create plaintext subscription (for backwards compatibility)
    const subscription = await db.subscription.create({
      userId: req.user.id,
      name, price, cycle, provider,
      privacyVersion: 1,
      createdAt: new Date()
    });

    return res.json(subscription);
  }
});
```

**Checklist**:
- [x] Update database schema
- [x] Add privacy fields (nullable at first)
- [x] Update API responses
- [x] Enable privacy flag in requests
- [x] Store keys securely
- [x] Add privacy version tracking

---

## Phase 2: Migrate Existing Data

### Step 2.1: Create Migration Script

```typescript
import { encryptSubscriptionMetadata, commit } from '@syncro/sdk';

async function migrateSubscriptionsToPrivacy(userId: string) {
  // Find all plaintext subscriptions
  const plaintext = await db.subscription.find({
    userId,
    privacyVersion: 1,
    encryptedMetadata: { $exists: false }
  });

  console.log(`Migrating ${plaintext.length} subscriptions...`);

  for (const subscription of plaintext) {
    try {
      // Generate encryption key
      const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
      const keyHex = bytesToHex(encryptionKey);

      // Encrypt metadata
      const encrypted = await encryptSubscriptionMetadata(keyHex, {
        name: subscription.name,
        price: subscription.price,
        cycle: subscription.cycle,
        provider: subscription.provider
      });

      // Create commitment
      const commitment = commit(BigInt(Math.floor(subscription.price * 100)));

      // Update database
      await db.subscription.update({
        id: subscription.id,
        $set: {
          encryptedMetadata: encrypted,
          amountCommitment: commitment.commitment,
          privacyVersion: 2,
          migratedAt: new Date(),
          // Keep old fields for rollback
          name_plaintext_backup: subscription.name,
          price_plaintext_backup: subscription.price
        }
      });

      // Store key securely
      await keyStore.set(`sub-${subscription.id}`, keyHex);

      console.log(`✓ Migrated: ${subscription.id}`);
    } catch (error) {
      console.error(`✗ Failed to migrate ${subscription.id}:`, error);
      // Log failure but continue
      await db.migrationLog.create({
        subscriptionId: subscription.id,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date()
      });
    }
  }

  console.log('Migration complete');
}

// Run migration
await migrateSubscriptionsToPrivacy(userId);
```

### Step 2.2: Gradual User Migration

Migrate users incrementally rather than all at once:

```typescript
async function startUserMigration(userId: string) {
  const user = await db.user.findById(userId);

  // Mark as in-progress
  await db.user.update({
    id: userId,
    migrationStatus: 'in-progress',
    migrationStartedAt: new Date()
  });

  try {
    // Run migration
    await migrateSubscriptionsToPrivacy(userId);

    // Mark as complete
    await db.user.update({
      id: userId,
      migrationStatus: 'complete',
      migrationCompletedAt: new Date()
    });

    // Send success email
    await sendMigrationCompleteEmail(user);
  } catch (error) {
    // Mark as failed
    await db.user.update({
      id: userId,
      migrationStatus: 'failed',
      migrationError: error instanceof Error ? error.message : String(error)
    });

    // Send error notification
    await sendMigrationFailureEmail(user, error);
  }
}

// Schedule migration for batches of users
async function scheduleBatchMigrations() {
  const usersToMigrate = await db.user.find({
    migrationStatus: { $ne: 'complete' },
    lastActive: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
  });

  for (const user of usersToMigrate) {
    // Stagger migrations to avoid database overload
    setTimeout(() => startUserMigration(user.id), Math.random() * 3600000);
  }
}
```

### Step 2.3: Handle Concurrent Reads During Migration

```typescript
async function getSubscription(subscriptionId: string) {
  const subscription = await db.subscription.findById(subscriptionId);

  // If migrated, decrypt
  if (subscription.privacyVersion === 2 && subscription.encryptedMetadata) {
    const keyHex = await keyStore.get(`sub-${subscriptionId}`);
    const metadata = await decryptSubscriptionMetadata(keyHex, subscription.encrypted);

    return {
      id: subscription.id,
      name: metadata.name,
      price: metadata.price,
      cycle: metadata.cycle,
      provider: metadata.provider
    };
  }

  // If not yet migrated, return plaintext
  if (subscription.privacyVersion === 1) {
    return {
      id: subscription.id,
      name: subscription.name,
      price: subscription.price,
      cycle: subscription.cycle,
      provider: subscription.provider
    };
  }

  throw new Error('Invalid subscription version');
}
```

### Step 2.4: Verify Migration

```typescript
async function verifyMigration(userId: string) {
  const subscriptions = await db.subscription.find({ userId });

  let plaintext = 0;
  let encrypted = 0;
  let errors = 0;

  for (const sub of subscriptions) {
    if (sub.privacyVersion === 1) {
      plaintext++;
    } else if (sub.privacyVersion === 2) {
      try {
        // Verify decryption works
        const keyHex = await keyStore.get(`sub-${sub.id}`);
        await decryptSubscriptionMetadata(keyHex, sub.encryptedMetadata);
        encrypted++;
      } catch (error) {
        errors++;
        console.error(`Decryption failed for ${sub.id}:`, error);
      }
    }
  }

  console.log(`
    Verification for user ${userId}:
    - Encrypted: ${encrypted}
    - Plaintext: ${plaintext}
    - Errors: ${errors}
  `);

  return { encrypted, plaintext, errors };
}
```

**Checklist**:
- [x] Create migration script
- [x] Test migration on sample data
- [x] Implement error handling
- [x] Add migration tracking
- [x] Gradual user migration
- [x] Handle concurrent access
- [x] Verify migration success
- [x] Create rollback plan

---

## Phase 3: Cleanup

### Step 3.1: Remove Plaintext Fields

After all users migrated and verified:

```typescript
async function finalizePrivacyMigration() {
  // Check all users are migrated
  const plaintext = await db.subscription.find({
    privacyVersion: 1
  });

  if (plaintext.length > 0) {
    throw new Error(`${plaintext.length} subscriptions still plaintext`);
  }

  // Remove plaintext backup fields (keep encrypted versions)
  await db.subscription.updateMany(
    { privacyVersion: 2 },
    {
      $unset: {
        name_plaintext_backup: 1,
        price_plaintext_backup: 1,
        cycle_plaintext_backup: 1,
        provider_plaintext_backup: 1
      }
    }
  );

  console.log('Plaintext fields removed');
}
```

### Step 3.2: Update API Response Format

```typescript
app.get('/api/subscriptions/:id', async (req, res) => {
  const subscription = await db.subscription.findById(req.params.id);

  if (subscription.privacyVersion !== 2) {
    return res.status(400).json({ error: 'Subscription not privacy-enabled' });
  }

  // Decrypt for response
  const keyHex = await keyStore.get(`sub-${subscription.id}`);
  const metadata = await decryptSubscriptionMetadata(
    keyHex,
    subscription.encryptedMetadata
  );

  res.json({
    id: subscription.id,
    name: metadata.name,
    price: metadata.price,
    cycle: metadata.cycle,
    provider: metadata.provider,
    // Don't expose internal fields
  });
});
```

### Step 3.3: Simplify Codebase

Remove `privacyVersion` checks once all data is migrated:

```typescript
// Before: multiple version checks
if (subscription.privacyVersion === 1) {
  // plaintext logic
} else if (subscription.privacyVersion === 2) {
  // encrypted logic
}

// After: only encrypted logic
const keyHex = await keyStore.get(`sub-${subscription.id}`);
const metadata = await decryptSubscriptionMetadata(keyHex, subscription.encrypted);
```

**Checklist**:
- [x] Verify all users migrated
- [x] Remove plaintext fields from database
- [x] Simplify API responses
- [x] Remove version checking code
- [x] Update documentation
- [x] Announce to users

---

## Rollback Plan

In case migration fails:

```typescript
async function rollbackMigration(userId: string) {
  const subscriptions = await db.subscription.find({
    userId,
    privacyVersion: 2,
    name_plaintext_backup: { $exists: true }
  });

  for (const sub of subscriptions) {
    // Restore plaintext fields
    await db.subscription.update({
      id: sub.id,
      $set: {
        name: sub.name_plaintext_backup,
        price: sub.price_plaintext_backup,
        cycle: sub.cycle_plaintext_backup,
        provider: sub.provider_plaintext_backup,
        privacyVersion: 1
      },
      $unset: {
        encryptedMetadata: 1,
        amountCommitment: 1,
        migratedAt: 1
      }
    });

    // Remove keys
    await keyStore.delete(`sub-${sub.id}`);
  }

  console.log(`Rolled back ${subscriptions.length} subscriptions`);
}
```

---

## Timeline Example

```
Week 1: Phase 1 (Add Infrastructure)
├─ Update schema
├─ Add storage layer
├─ Enable privacy flag
└─ Test with new subscriptions

Week 2: Phase 2 (Migrate Data)
├─ Run migration for 10% of users (Monday)
├─ Monitor for errors
├─ Run migration for 50% of users (Wednesday)
├─ Verify completeness
└─ Run migration for final 40% of users (Friday)

Week 3: Phase 3 (Cleanup)
├─ Verify all data encrypted
├─ Remove plaintext backups
├─ Simplify codebase
└─ Document changes

Week 4: Stabilization
├─ Monitor for issues
├─ Fix any edge cases
├─ Update user documentation
└─ Announce privacy feature
```

---

## Common Challenges & Solutions

### Challenge 1: Keys Stored Anywhere?

```typescript
// Audit: Find where keys might be stored
async function auditKeyStorage() {
  // Check localStorage (browser)
  // Check session storage
  // Check cookies
  // Check Redis/cache
  // Check database
  // Check logs

  // Remove from anywhere except secure key store
}

// Solution: Use dedicated key store
class SecureKeyStore {
  private keys = new Map<string, string>(); // In-memory only

  async set(id: string, key: string) {
    this.keys.set(id, key);
  }

  async get(id: string) {
    return this.keys.get(id);
  }

  // Clear on logout
  async clear() {
    this.keys.clear();
  }
}
```

### Challenge 2: Large Data Volumes

```typescript
// Problem: Migrating millions of subscriptions is slow

// Solution: Use pagination and background jobs
async function migrateInBatches(userId: string, batchSize = 100) {
  let offset = 0;
  let total = 0;

  while (true) {
    const subscriptions = await db.subscription.find(
      { userId, privacyVersion: 1 },
      { skip: offset, limit: batchSize }
    );

    if (subscriptions.length === 0) break;

    for (const sub of subscriptions) {
      await migrateSingleSubscription(sub);
    }

    total += subscriptions.length;
    offset += batchSize;

    console.log(`Migrated ${total} subscriptions...`);
  }
}

// Use job queue for large-scale migrations
async function enqueueMigrationJob(userId: string) {
  await jobQueue.enqueue('migrate_privacy', { userId });
}
```

### Challenge 3: Testing Encrypted Data

```typescript
// Solution: Mock key store for tests
class MockKeyStore {
  private keys = new Map<string, string>();

  async set(id: string, key: string) {
    this.keys.set(id, key);
  }

  async get(id: string) {
    return this.keys.get(id);
  }
}

// Use in tests
test('migration preserves subscription data', async () => {
  const mockKeyStore = new MockKeyStore();
  // ... run migration with mock store
  // ... verify data integrity
});
```

---

## Monitoring & Logging

```typescript
// Track migration progress
async function logMigrationMetrics(userId: string) {
  const stats = await verifyMigration(userId);

  await db.metrics.create({
    event: 'migration_completed',
    userId,
    timestamp: new Date(),
    data: stats
  });

  if (stats.errors > 0) {
    // Alert team
    await alertTeam(`Migration errors for user ${userId}: ${stats.errors}`);
  }
}

// Monitor for decryption failures
app.get('/api/subscriptions/:id', async (req, res) => {
  try {
    const subscription = getSubscription(req.params.id);
    return res.json(subscription);
  } catch (error) {
    // Log failure
    await db.errors.create({
      event: 'decryption_failed',
      subscriptionId: req.params.id,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date()
    });

    return res.status(500).json({ error: 'Failed to retrieve subscription' });
  }
});
```

---

## Success Criteria

Migration is successful when:

- ✅ 100% of target users migrated
- ✅ 0% decryption failure rate
- ✅ <1% API error increase
- ✅ No user complaints about data loss
- ✅ All backups verified and secure
- ✅ No plaintext data in logs/metrics
- ✅ Performance metrics stable

---

## Post-Migration

After successful migration:

1. **Announce feature**: Tell users about new privacy capabilities
2. **Update docs**: Document privacy features for developers
3. **Monitor**: Watch for issues in first week
4. **Optimize**: Profile and optimize hot paths
5. **Deprecate**: Mark plaintext APIs as deprecated
6. **Plan next**: Consider additional privacy features

---

## Next Steps

1. Review [Security Considerations](./security-considerations.md)
2. Read [Integration Guide](./integration-guide.md)
3. Run [Test Vectors](./test-vectors.md)
4. Deploy with [Deployment Guide](./deployment-guide.md)
