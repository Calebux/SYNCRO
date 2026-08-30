# Stealth Payment Memo Implementation (#868)

## Overview

This implementation enables ephemeral public key embedding in Stellar transaction memo fields to support stealth payment detection. The ephemeral pubkey (32 bytes) is encoded in the Stellar `memo_return` field, allowing recipient scanning services to identify stealth payments.

## Architecture

### Components

#### 1. **shared/src/stealth-derive.ts** - Memo Encoding/Decoding
- `encodeSteathMemo(ephemeralPubkey)` - Encode 32-byte ephemeral pubkey as base64 for memo_return
- `decodeStealthMemo(memoReturn)` - Decode base64 memo back to hex ephemeral pubkey
- `isStealthMemo(memoType, memoValue)` - Validate memo matches stealth pattern (32-byte return memo)
- `createStealthMemoObject(ephemeralPubkey)` - Create Stellar memo object for transaction builder

#### 2. **backend/src/services/stealth-scanner.ts** - Payment Detection
- `scanTransactionForStealth(tx, recipientAddress)` - Identify stealth payments in single transaction
- `scanTransactionsForStealth(txs, recipientAddress)` - Batch scan multiple transactions
- `storeStealthPayment(record, userId)` - Persist detected payment to database
- `getUserStealthPayments(userId, limit)` - Query user's stealth payment history

#### 3. **backend/src/services/renewal-executor.ts** - Renewal with Stealth Support
- Accept `useStealthPayment` and `ephemeralPubkey` parameters in renewal request
- Validate stealth payment parameters before execution
- Set memo on transaction via `createStealthMemoObject()`
- Record detected stealth payments after successful renewal

#### 4. **supabase/migrations/20260624000000_create_stealth_payments_table.sql** - Storage
- `stealth_payments` table with user-scoped RLS policies
- Tracks transaction_hash, ephemeral_pubkey, amount, asset, ledger
- Unique constraint on transaction_hash to prevent duplicates

## Memo Format

### Stellar Specification
- **Field**: `memo_return` (32 bytes binary)
- **Encoding**: Base64 (fits in Stellar transaction memo)
- **Content**: 32-byte compressed ephemeral public key (R)
- **Pattern**: Pure pubkey without prefix (for efficiency)

### Validation
```typescript
// Valid stealth memo
{
  type: 'return',
  value: 'oGBR2P3vfvB...' // 32 bytes in base64
}

// Scanner validates: base64 decoded length === 32 bytes
```

## Usage

### Sending Stealth Payment
```typescript
const renewalRequest: RenewalRequest = {
  subscriptionId: 'sub-123',
  userId: 'user-456',
  approvalId: 'approval-789',
  amount: 9.99,
  useStealthPayment: true,
  ephemeralPubkey: 'a1b2c3d4...', // 32 bytes hex-encoded
};

const result = await renewalExecutor.executeRenewal(renewalRequest);
// Transaction includes memo_return with ephemeralPubkey
// Stealth payment recorded after success
```

### Scanning Transactions
```typescript
const txs = await sorobanRpc.getTransaction(txHash);
const stealthPayments = stealthScanner.scanTransactionForStealth(
  txs,
  'GXXXXXXXXX' // recipient address
);

// Record detected payments
if (stealthPayments) {
  await stealthScanner.storeStealthPayment(stealthPayments, userId);
}
```

### Querying History
```typescript
const payments = await stealthScanner.getUserStealthPayments(userId, 100);
// Returns: [{ transactionHash, ephemeralPubkey, amount, asset, ... }]
```

## Acceptance Criteria ✓

- **Ephemeral pubkey fits in Stellar memo field**
  - 32 bytes fits in memo_return (32-byte field)
  - Base64 encoding maintains compatibility with Stellar SDK

- **Scanner correctly identifies stealth payments by memo pattern**
  - Validates memo_return type
  - Decodes and verifies 32-byte length
  - Extracts payment operation matching recipient

- **Non-stealth transactions are unaffected**
  - Optional `useStealthPayment` parameter (defaults false)
  - Normal renewals work unchanged
  - Backward compatible with existing transaction flow

## Data Flow

```
RenewalRequest (with stealth params)
         ↓
validateBillingWindow()
         ↓
triggerContractRenewal()
  ├─ createStealthMemoObject(ephemeralPubkey)
  └─ blockchainService.syncSubscription(payloadData with memo)
         ↓
Transaction includes memo_return
         ↓
EventListener detects transaction
         ↓
StealthScanner.scanTransactionForStealth()
         ↓
storeStealthPayment() → Database
```

## Security Considerations

1. **Ephemeral Key Rotation**: Keys should be generated fresh per transaction
2. **No Private Key Storage**: Only public ephemeral keys stored in memo
3. **User Privacy**: Scanning service cannot trace to identity without additional context
4. **Memo Field Immutability**: Cannot be modified after transaction creation

## Testing

- Unit tests for memo encoding/decoding (stealth-derive.ts)
- Integration tests for scanner (stealth-scanner.ts)
- Renewal executor tests with stealth parameters
- Database migration validation

See `backend/tests/renewal-executor.test.ts` for test cases.

## Future Enhancements

1. **Batch Scanning**: Process multiple transactions in parallel
2. **Cache Layer**: Redis cache for scanned transaction hashes
3. **Subscriber Notifications**: Alert on detected stealth payments
4. **Analytics**: Track stealth payment adoption rates
5. **Stealth Recovery**: Help users recover funds sent via stealth
