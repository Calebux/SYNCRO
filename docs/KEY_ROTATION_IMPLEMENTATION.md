# Key Rotation Implementation for Wallet Changes

## Overview

This document describes the implementation of encryption key rotation when a user changes their Stellar wallet. The system ensures that previously encrypted subscription data remains accessible after a wallet change by re-encrypting all data with a new key derived from the new wallet.

## Problem Statement

- **Issue**: When a user changes their Stellar wallet, the HKDF-derived encryption key changes
- **Impact**: Previously encrypted subscription data cannot be decrypted with the new key
- **Solution**: Implement automatic re-encryption during wallet change with progress tracking

## Architecture

### Key Derivation

Encryption keys are derived from Stellar wallet public keys using HKDF-SHA256:

```typescript
deriveKey(walletPublicKey, {
  salt: 'syncro-encryption',
  info: 'subscription-metadata-encryption-v1',
  length: 32 // 256-bit key
})
```

This provides:
- **Deterministic**: Same wallet always produces the same key
- **Self-custodial**: Only the wallet owner can derive the key
- **Secure**: HKDF ensures cryptographic strength

### Re-encryption Flow

1. **Detection**: System detects when user connects a different wallet
2. **Warning**: User is shown data loss warning before proceeding
3. **Initiation**: Backend creates rotation tracking records
4. **Re-encryption**: Client decrypts with old key, re-encrypts with new key
5. **Progress**: Real-time progress updates for user
6. **Completion**: Backend updates user preferences with new encryption key

## Database Schema

### User Preferences Extensions

```sql
ALTER TABLE user_preferences ADD COLUMN:
  - previous_wallet_public_key TEXT
  - previous_encryption_key TEXT
  - rotation_in_progress BOOLEAN
  - rotation_started_at TIMESTAMPTZ
  - rotation_completed_at TIMESTAMPTZ
```

### Re-encryption Progress Tracking

```sql
CREATE TABLE subscription_reencryption_progress (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  old_wallet_public_key TEXT NOT NULL,
  new_wallet_public_key TEXT NOT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## API Endpoints

### Backend Routes (`/api/key-rotation`)

1. **POST /initiate**
   - Starts key rotation process
   - Creates progress tracking records
   - Requires: `oldWalletPublicKey`, `newWalletPublicKey`

2. **GET /progress**
   - Returns current rotation progress
   - Response: `{ inProgress, totalSubscriptions, completedSubscriptions, percentComplete }`

3. **POST /reencrypt-subscription**
   - Saves re-encrypted subscription data
   - Updates progress tracking
   - Requires: `subscriptionId`, `encryptedData`

4. **POST /complete**
   - Finalizes key rotation
   - Updates user encryption key
   - Cleans up tracking data

5. **POST /cancel**
   - Cancels ongoing rotation
   - Reverts to old wallet
   - Cleans up progress records

## Client Implementation

### Key Files

1. **`client/lib/stellar-wallet.ts`**
   - Detects wallet changes
   - Emits `walletChanged` event
   - Provides `deriveEncryptionKey()` method

2. **`client/lib/key-rotation-client.ts`**
   - Orchestrates re-encryption process
   - Handles API communication
   - Provides progress callbacks

3. **`client/app/settings/wallet/page.tsx`**
   - Wallet management UI
   - Warning dialogs
   - Progress visualization
   - Error handling

### Re-encryption Process

```typescript
// 1. Initiate rotation
await keyRotationClient.initiateKeyRotation(oldKey, newKey);

// 2. Fetch encrypted subscriptions
const subscriptions = await keyRotationClient.fetchEncryptedSubscriptions();

// 3. Re-encrypt each subscription
for (const sub of subscriptions) {
  // Decrypt with old key
  const decrypted = await decryptMetadata(sub.encrypted_data, oldKey);
  
  // Re-encrypt with new key
  const reEncrypted = await encryptMetadata(decrypted, newKey);
  
  // Save to backend
  await keyRotationClient.reEncryptSubscription(sub.id, reEncrypted);
}

// 4. Complete rotation
await keyRotationClient.completeKeyRotation(newKey);
```

## User Experience

### Wallet Change Flow

1. User navigates to Settings → Wallet Management
2. Clicks "Change Wallet"
3. Sees warning dialog explaining:
   - Re-encryption requirement
   - Data loss risk if old wallet is lost
   - Process cannot be interrupted
4. Confirms and connects new wallet via Freighter
5. System verifies new wallet is different
6. Re-encryption begins with progress bar
7. Shows: `X of Y subscriptions re-encrypted (Z%)`
8. On completion: Success message
9. On failure: Error details and cancel option

### Progress Tracking

Real-time progress display:
- Progress bar (0-100%)
- Count: "5 of 20 subscriptions"
- Status messages
- Cancel button (before completion)

## Security Considerations

### Data Loss Prevention

⚠️ **Important Warnings**:
- User must have access to old wallet during rotation
- If rotation is interrupted, old key is preserved
- User can cancel and retry with old wallet
- Lost wallet = lost encrypted data (acceptable for self-custodial)

### Key Derivation Security

- HKDF-SHA256 provides cryptographic strength
- Unique salt and info strings prevent key reuse
- 256-bit keys provide strong encryption
- Keys never stored in plaintext (only derived)

### Audit Trail

All key rotations are logged with:
- User ID
- Old wallet public key (truncated)
- New wallet public key (truncated)
- Timestamp
- Status (success/failure)
- Emitted as security events

## Error Handling

### Common Errors

1. **Same Wallet Connected**
   - Detection: Compare old and new public keys
   - Action: Prompt user to connect different wallet

2. **Decryption Failure**
   - Cause: Wrong old key or corrupted data
   - Action: Mark subscription as failed, continue with others
   - Recovery: User can manually fix or delete subscription

3. **Network Errors**
   - Action: Retry mechanism with exponential backoff
   - Fallback: Allow user to cancel and retry later

4. **Incomplete Rotation**
   - Detection: Check progress before allowing new operations
   - Action: Force completion or cancellation
   - UI: Show "Rotation in progress" banner

## Testing Strategy

### Unit Tests

- Key derivation consistency
- Encryption/decryption with rotated keys
- Progress calculation
- Error handling

### Integration Tests

- Full rotation flow
- API endpoint responses
- Database state consistency
- Cancellation behavior

### Manual Testing

1. Connect wallet A
2. Encrypt some subscriptions
3. Change to wallet B
4. Verify all subscriptions are accessible
5. Test cancellation mid-rotation
6. Test error recovery

## Migration Path

### Existing Users

For users with non-wallet-derived encryption keys:

1. Check if `encryption_key` exists in `user_preferences`
2. If not derived from wallet, prompt one-time migration
3. Store old key as `previous_encryption_key`
4. Derive new key from connected wallet
5. Trigger re-encryption

### Rollout Plan

1. Deploy database migrations
2. Deploy backend services
3. Deploy frontend UI
4. Monitor error rates
5. Gradual rollout to user segments

## Performance Considerations

### Optimization

- Batch API calls for multiple subscriptions
- Parallel re-encryption (with rate limiting)
- Progress caching to survive page refreshes
- Resumable rotation (track completion per subscription)

### Expected Performance

- 1 subscription: ~100ms
- 10 subscriptions: ~1 second
- 100 subscriptions: ~10 seconds
- Large datasets: Show estimated time remaining

## Future Enhancements

1. **Key History**
   - Store encrypted old keys under new key
   - Allow decryption of historical backups

2. **Multi-Wallet Support**
   - Support multiple verified wallets
   - Primary wallet for encryption
   - Fallback wallets for recovery

3. **Background Re-encryption**
   - Queue-based re-encryption
   - Async processing with job tracking
   - Email notification on completion

4. **Backup Export**
   - Export encrypted data with old key
   - Import and re-encrypt with current key
   - Supports wallet recovery scenarios

## References

- [HKDF RFC 5869](https://tools.ietf.org/html/rfc5869)
- [AES-GCM Encryption](https://en.wikipedia.org/wiki/Galois/Counter_Mode)
- [Stellar Documentation](https://developers.stellar.org/)
- [Freighter Wallet](https://www.freighter.app/)

## Support

For issues or questions:
1. Check error messages in browser console
2. Review audit logs in security events
3. Contact support with:
   - User ID
   - Timestamp of rotation attempt
   - Error message
   - Browser console logs
