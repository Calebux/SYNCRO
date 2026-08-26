# Wallet Key Rotation Flow Diagram

## User Journey Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    USER INITIATES WALLET CHANGE                      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Settings → Wallet Management → Click "Change Wallet"                │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                          WARNING MODAL                               │
│  ⚠️  Wallet Change Requires Re-encryption                           │
│                                                                       │
│  Important:                                                           │
│  • All encrypted data will be re-encrypted with new key              │
│  • Process cannot be interrupted once started                        │
│  • Data loss risk if old wallet is inaccessible                     │
│  • Must have access to both wallets during process                  │
│                                                                       │
│              [Cancel]           [Continue]                           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                     User Clicks "Continue"
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│              DISCONNECT OLD WALLET & CONNECT NEW WALLET              │
│                    (via Freighter Extension)                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      WALLET VALIDATION                               │
│  • Verify new wallet is different from old                          │
│  • Verify new wallet is authenticated                               │
│  • Check wallet verification status                                 │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                   INITIATE KEY ROTATION (Backend)                    │
│  POST /api/key-rotation/initiate                                     │
│  • Create progress tracking records                                 │
│  • Mark rotation_in_progress = true                                │
│  • Store old wallet public key                                      │
│  • Return total subscription count                                  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                RE-ENCRYPTION PROCESS (Client-Side)                   │
│                                                                       │
│  For each encrypted subscription:                                    │
│  ┌───────────────────────────────────────────────────────┐          │
│  │ 1. Fetch encrypted data from backend                  │          │
│  │ 2. Derive OLD key from old wallet public key (HKDF)  │          │
│  │ 3. Decrypt data with OLD key (AES-GCM)               │          │
│  │ 4. Derive NEW key from new wallet public key (HKDF)  │          │
│  │ 5. Re-encrypt data with NEW key (AES-GCM)            │          │
│  │ 6. POST to /api/key-rotation/reencrypt-subscription   │          │
│  │ 7. Update progress tracking                           │          │
│  └───────────────────────────────────────────────────────┘          │
│                                                                       │
│  Progress Display:                                                   │
│  ████████████░░░░░░░░ 60%                                           │
│  12 of 20 subscriptions                                             │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPLETE KEY ROTATION (Backend)                   │
│  POST /api/key-rotation/complete                                     │
│  • Update user_preferences.encryption_key                           │
│  • Set rotation_in_progress = false                                │
│  • Set rotation_completed_at timestamp                             │
│  • Clean up temporary data                                          │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         SUCCESS MESSAGE                              │
│  ✅ Wallet changed and all data re-encrypted successfully!          │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Derivation Flow

```
┌──────────────────────────────────┐
│  Stellar Wallet Public Key       │
│  (e.g., GXXXXXXXX...XXXXXXX)     │
└──────────────────────────────────┘
              │
              ↓
┌──────────────────────────────────┐
│        HKDF-SHA256               │
│                                  │
│  Input:  Public Key (hex)        │
│  Salt:   'syncro-encryption'     │
│  Info:   'subscription-metadata- │
│          encryption-v1'          │
│  Length: 32 bytes (256 bits)     │
└──────────────────────────────────┘
              │
              ↓
┌──────────────────────────────────┐
│   256-bit Encryption Key         │
│   (Deterministic & Unique)       │
└──────────────────────────────────┘
              │
              ↓
┌──────────────────────────────────┐
│      AES-GCM Encryption          │
│   • Encrypt subscription data    │
│   • Generate IV & Auth Tag       │
│   • Store as JSON                │
└──────────────────────────────────┘
```

## Database State Transitions

```
BEFORE ROTATION:
┌─────────────────────────────────────┐
│ user_preferences                    │
├─────────────────────────────────────┤
│ encryption_key: "abc123..."         │
│ rotation_in_progress: false         │
│ previous_wallet_public_key: null    │
└─────────────────────────────────────┘

DURING ROTATION:
┌─────────────────────────────────────┐
│ user_preferences                    │
├─────────────────────────────────────┤
│ encryption_key: "abc123..." (old)   │
│ rotation_in_progress: true          │
│ previous_wallet_public_key: "GXX.." │
│ rotation_started_at: 2026-06-24...  │
└─────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ subscription_reencryption_progress  │
├─────────────────────────────────────┤
│ sub_id_1: pending                   │
│ sub_id_2: in_progress              │
│ sub_id_3: completed                │
│ sub_id_4: pending                   │
└─────────────────────────────────────┘

AFTER ROTATION:
┌─────────────────────────────────────┐
│ user_preferences                    │
├─────────────────────────────────────┤
│ encryption_key: "xyz789..." (new)   │
│ rotation_in_progress: false         │
│ previous_wallet_public_key: null    │
│ rotation_completed_at: 2026-06-24.. │
└─────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ subscription_reencryption_progress  │
├─────────────────────────────────────┤
│ sub_id_1: completed                 │
│ sub_id_2: completed                │
│ sub_id_3: completed                │
│ sub_id_4: completed                 │
└─────────────────────────────────────┘
```

## Component Interaction Diagram

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Frontend UI   │◄────────┤  Wallet Hook     │◄────────┤  Freighter      │
│  (Wallet Page)  │         │  (use-wallet.ts) │         │  Extension      │
└────────┬────────┘         └──────────────────┘         └─────────────────┘
         │                           │
         │ User Action               │ walletChanged event
         ↓                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Key Rotation Client                               │
│                  (key-rotation-client.ts)                           │
│  • initiateKeyRotation()                                            │
│  • performReEncryption()                                            │
│  • completeKeyRotation()                                            │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ API Calls
         ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Backend API Routes                                │
│                  (/api/key-rotation/*)                              │
│  • POST /initiate                                                    │
│  • GET /progress                                                     │
│  • POST /reencrypt-subscription                                      │
│  • POST /complete                                                    │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ Service Layer
         ↓
┌─────────────────────────────────────────────────────────────────────┐
│                 Key Rotation Service                                 │
│              (key-rotation-service.ts)                              │
│  • Database operations                                               │
│  • Progress tracking                                                 │
│  • Key derivation                                                    │
│  • Audit logging                                                     │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ Database Queries
         ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         Database                                     │
│  • user_preferences                                                  │
│  • subscription_reencryption_progress                               │
│  • subscriptions                                                     │
│  • wallet_verifications                                             │
└─────────────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Error Occurs During Rotation                    │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
                          ┌────────┴────────┐
                          │                 │
                    Network Error     Decryption Error
                          │                 │
                          ↓                 ↓
              ┌─────────────────┐  ┌──────────────────┐
              │ Retry Logic     │  │ Mark as Failed   │
              │ • Exponential   │  │ • Log error      │
              │   backoff       │  │ • Continue with  │
              │ • 3 attempts    │  │   next sub       │
              └─────────────────┘  └──────────────────┘
                          │                 │
                          └────────┬────────┘
                                   │
                                   ↓
                   ┌───────────────────────────────┐
                   │  Display Error to User        │
                   │  • Show error message         │
                   │  • Offer retry or cancel      │
                   │  • Log to audit trail         │
                   └───────────────────────────────┘
                                   │
                                   ↓
                          ┌────────┴────────┐
                          │                 │
                    User Retries     User Cancels
                          │                 │
                          ↓                 ↓
              ┌─────────────────┐  ┌──────────────────┐
              │ Resume Process  │  │ Rollback         │
              │ from checkpoint │  │ • Clean up       │
              └─────────────────┘  │ • Revert state   │
                                   │ • Keep old key   │
                                   └──────────────────┘
```

## Security Event Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Key Rotation Initiated                            │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Emit Security Event                               │
│  Event: auth.mfa_disabled (severity: medium)                        │
│  Actor: user_id                                                      │
│  Resource: encryption_key                                            │
│  Details:                                                            │
│    - oldWallet: GXXX...XXX                                          │
│    - newWallet: GYYY...YYY                                          │
│    - totalSubscriptions: 20                                         │
│    - timestamp: 2026-06-24T10:30:00Z                                │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      Audit Trail Storage                             │
│  • Stored in audit_events table                                     │
│  • Indexed for security queries                                     │
│  • Available for compliance reports                                 │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Key Rotation Completed                            │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Emit Security Event                               │
│  Event: auth.mfa_enabled (severity: low)                            │
│  Actor: user_id                                                      │
│  Resource: encryption_key                                            │
│  Details:                                                            │
│    - newWallet: GYYY...YYY                                          │
│    - totalSubscriptions: 20                                         │
│    - duration: 3.2 seconds                                          │
│    - timestamp: 2026-06-24T10:30:03Z                                │
└─────────────────────────────────────────────────────────────────────┘
```

## Timeline Example

```
Time: 10:30:00
┌─────────────────────────────────────────────────────────────────────┐
│ User clicks "Change Wallet"                                          │
└─────────────────────────────────────────────────────────────────────┘

Time: 10:30:02
┌─────────────────────────────────────────────────────────────────────┐
│ User confirms warning modal                                          │
└─────────────────────────────────────────────────────────────────────┘

Time: 10:30:05
┌─────────────────────────────────────────────────────────────────────┐
│ New wallet connected via Freighter                                   │
└─────────────────────────────────────────────────────────────────────┘

Time: 10:30:06
┌─────────────────────────────────────────────────────────────────────┐
│ Backend: Rotation initiated (20 subscriptions)                       │
└─────────────────────────────────────────────────────────────────────┘

Time: 10:30:07 - 10:30:09
┌─────────────────────────────────────────────────────────────────────┐
│ Re-encrypting subscriptions (progress bar updates in real-time)      │
│ Progress: 0% → 25% → 50% → 75% → 100%                               │
└─────────────────────────────────────────────────────────────────────┘

Time: 10:30:10
┌─────────────────────────────────────────────────────────────────────┐
│ Backend: Rotation completed successfully                             │
└─────────────────────────────────────────────────────────────────────┘

Time: 10:30:11
┌─────────────────────────────────────────────────────────────────────┐
│ User sees success message                                            │
│ All data now accessible with new wallet-derived key                 │
└─────────────────────────────────────────────────────────────────────┘

Total Duration: 11 seconds (for 20 subscriptions)
```

---

## Summary

This flow diagram illustrates:
- ✅ Complete user journey from wallet change to completion
- ✅ Key derivation process using HKDF-SHA256
- ✅ Database state transitions during rotation
- ✅ Component interactions and API flow
- ✅ Error handling and recovery paths
- ✅ Security event emissions
- ✅ Real-world timeline example

All flows are designed for maximum security, user transparency, and error recovery.
