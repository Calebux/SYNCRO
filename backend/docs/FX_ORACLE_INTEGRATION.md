# FX Oracle Backend Integration

## Overview

The FX Oracle integration enables on-chain validation of foreign exchange rates used in multi-currency subscription renewals. This document describes how the backend services interact with the oracle contract.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Backend Services                           │
│                                                                │
│  ┌─────────────────────┐         ┌─────────────────────┐    │
│  │ Exchange Rate       │         │ FX Oracle Feeder    │    │
│  │ Service             │────────▶│                     │    │
│  │                     │ rates   │ - Fetch rates       │    │
│  │ - ExchangeRate-API  │         │ - Convert format    │    │
│  │ - Frankfurter       │         │ - Submit to chain   │    │
│  │ - CoinGecko         │         │                     │    │
│  └─────────────────────┘         └──────────┬──────────┘    │
│                                              │                │
└──────────────────────────────────────────────┼────────────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Stellar Blockchain                         │
│                                                                │
│  ┌─────────────────────┐         ┌─────────────────────┐    │
│  │ FX Oracle Contract  │         │ Subscription        │    │
│  │                     │────────▶│ Renewal Contract    │    │
│  │ - Rate storage      │validate │                     │    │
│  │ - Staleness check   │         │ - Multi-currency    │    │
│  │ - Signer verify     │         │ - FX validation     │    │
│  └─────────────────────┘         └─────────────────────┘    │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

## Components

### 1. FxOracleFeeder Service

**Location**: `backend/src/services/fx-oracle-feeder.ts`

**Responsibilities**:
- Fetch FX rates from ExchangeRateService
- Convert rates to 8-decimal fixed-point format
- Submit rates to oracle contract via blockchain service
- Handle retries and error reporting
- Monitor rate freshness

**Configuration**:

```typescript
interface OracleConfig {
  contractAddress: string;  // Oracle contract address
  updateInterval: number;   // Update frequency (ms)
  currencies: string[];     // Currencies to track
  baseCurrency: string;     // Base currency (usually "USD")
}
```

**Environment Variables**:

```bash
# Enable FX oracle feeding
FX_ORACLE_ENABLED=true

# Oracle contract address (deployed contract ID)
FX_ORACLE_CONTRACT_ADDRESS=CBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Update interval in milliseconds (default: 15 minutes)
FX_ORACLE_UPDATE_INTERVAL=900000

# Currencies to feed (comma-separated)
FX_ORACLE_CURRENCIES=EUR,GBP,JPY,CAD,AUD,NGN,GHS,KES,ZAR

# Base currency for rates
FX_ORACLE_BASE_CURRENCY=USD

# Signer account secret key (authorized to update rates)
FX_ORACLE_SIGNER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 2. Integration with Renewal Executor

**Location**: `backend/src/services/renewal-executor.ts`

The renewal executor has been extended to handle multi-currency subscriptions with FX validation:

```typescript
async executeRenewal(request: RenewalRequest): Promise<RenewalResult> {
  // ... existing approval and window checks ...

  // Check if currency conversion is needed
  if (subscription.currency !== paymentCurrency) {
    // Backend calculates expected amount using latest rates
    const expectedAmount = await this.calculateRenewalAmount(
      subscription.amount,
      subscription.currency,
      paymentCurrency
    );

    // Contract will validate this amount against oracle rate
    request.amount = expectedAmount;
  }

  // ... submit to contract ...
}
```

## Rate Format Conversion

### From API to Fixed-Point

Exchange rate APIs return floating-point numbers (e.g., `0.92`). The oracle stores rates as 8-decimal integers:

```typescript
// API rate: 0.92 EUR per USD
const apiRate = 0.92;

// Convert to fixed-point (multiply by 10^8)
const fixedPointRate = BigInt(Math.round(apiRate * 100_000_000));
// Result: 92_000_000n
```

### From Fixed-Point to Amount

When converting subscription amounts:

```typescript
// Subscription: 100 USD, rate: 92_000_000 (0.92 EUR/USD)
const amountUSD = 100_00000000n; // 100 USD in 8 decimals
const rate = 92_000_000n;

// Convert: (amount * rate) / 10^8
const amountEUR = (amountUSD * rate) / 100_000_000n;
// Result: 92_00000000n (92 EUR)
```

## Deployment Steps

### 1. Deploy Oracle Contract

```bash
# Build contracts
cd contracts
cargo build --release --target wasm32-unknown-unknown

# Deploy oracle
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/fx_oracle.wasm \
  --source ADMIN_SECRET \
  --network testnet

# Returns: Contract ID (e.g., CBXXXXXXX...)
```

### 2. Initialize Oracle

```bash
# Set admin
stellar contract invoke \
  --id <ORACLE_CONTRACT_ID> \
  --source ADMIN_SECRET \
  --network testnet \
  -- init \
  --admin <ADMIN_ADDRESS>

# Add rate feeder signer
stellar contract invoke \
  --id <ORACLE_CONTRACT_ID> \
  --source ADMIN_SECRET \
  --network testnet \
  -- add_signer \
  --signer <FEEDER_ADDRESS>

# Set staleness bound (1 hour = 3600 seconds)
stellar contract invoke \
  --id <ORACLE_CONTRACT_ID> \
  --source ADMIN_SECRET \
  --network testnet \
  -- set_staleness_bound \
  --seconds 3600
```

### 3. Update Subscription Renewal Contract

```bash
# Link oracle to renewal contract
stellar contract invoke \
  --id <RENEWAL_CONTRACT_ID> \
  --source ADMIN_SECRET \
  --network testnet \
  -- set_fx_oracle_contract \
  --address <ORACLE_CONTRACT_ID>
```

### 4. Configure Backend

Update `.env` file:

```bash
FX_ORACLE_ENABLED=true
FX_ORACLE_CONTRACT_ADDRESS=<ORACLE_CONTRACT_ID>
FX_ORACLE_SIGNER_SECRET=<FEEDER_SECRET_KEY>
FX_ORACLE_UPDATE_INTERVAL=900000
FX_ORACLE_CURRENCIES=EUR,GBP,JPY,CAD,AUD,NGN,GHS,KES,ZAR
FX_ORACLE_BASE_CURRENCY=USD
```

### 5. Start Oracle Feeder

The feeder starts automatically when the backend server starts (if `FX_ORACLE_ENABLED=true`):

```bash
npm run start
# Logs: "Starting FX Oracle Feeder..."
```

## Monitoring

### Key Metrics

1. **Rate Update Success Rate**
   - Track successful vs. failed rate submissions
   - Alert if success rate < 90%

2. **Rate Freshness**
   - Monitor time since last successful update
   - Alert if > staleness bound

3. **API Rate Limit Usage**
   - Track calls to external FX APIs
   - Implement backoff if approaching limits

4. **Contract Call Costs**
   - Monitor XLM spent on rate updates
   - Optimize update frequency vs. cost

### Logging

The feeder logs all operations:

```typescript
// Successful update
logger.info('FX Oracle rate update completed', {
  successCount: 10,
  failureCount: 0,
  totalUpdates: 10,
  durationMs: 1234,
  source: 'live',
});

// Failed update
logger.error('Oracle update failed for currency', {
  currency: 'EUR',
  error: 'Transaction failed',
});

// Stale data warning
logger.warn('Exchange rate service returned stale data', {
  source: 'stale-cache',
  ageMs: 7200000,
});
```

### Health Check Endpoint

Add to Express app:

```typescript
app.get('/api/health/oracle', async (req, res) => {
  const feeder = getOracleFeeder();
  const status = feeder.getStatus();

  // Check if rates are fresh
  const rates = await exchangeRateService.getExchangeRateResponse('USD');
  const freshness = rates.stale ? 'stale' : 'fresh';

  res.json({
    enabled: status.isRunning,
    contractAddress: status.config.contractAddress,
    currencies: status.config.currencies,
    updateInterval: status.config.updateInterval,
    ratesFreshness: freshness,
    ratesAgeMs: rates.ageMs,
  });
});
```

## Error Handling

### Rate Update Failures

```typescript
// Automatic retry with exponential backoff
private async submitWithRetry(
  update: OracleRateUpdate,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.submitSingleUpdate(update);
      return; // Success
    } catch (error) {
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }
      const delayMs = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
```

### Staleness Handling

If external APIs return stale data:
1. Log warning
2. Continue with stale data (better than no update)
3. Alert if staleness exceeds threshold
4. Try alternate providers

### Transaction Failures

If contract invocation fails:
1. Log error with transaction details
2. Retry with backoff
3. Alert after N consecutive failures
4. Fall back to static rates in renewal executor

## Testing

### Unit Tests

```bash
cd backend
npm test fx-oracle-feeder
```

### Integration Tests

1. **Mock Oracle Contract**:
   ```typescript
   const mockContract = {
     update_rate: jest.fn().mockResolvedValue({ success: true }),
   };
   ```

2. **Test Rate Submission**:
   ```typescript
   it('submits rates to oracle', async () => {
     await feeder.updateRates();
     expect(mockContract.update_rate).toHaveBeenCalledWith(
       'USD',
       'EUR',
       '92000000',
       expect.any(Number)
     );
   });
   ```

### End-to-End Tests

1. Deploy contracts to testnet
2. Configure backend with testnet keys
3. Start oracle feeder
4. Create multi-currency subscription
5. Trigger renewal
6. Verify FX validation occurred on-chain

## Operational Runbook

### Adding a New Currency

1. Update `FX_ORACLE_CURRENCIES` environment variable
2. Restart backend service
3. Verify rate updates in logs
4. Check oracle contract storage

### Changing Staleness Bound

```bash
stellar contract invoke \
  --id <ORACLE_CONTRACT_ID> \
  --source ADMIN_SECRET \
  --network mainnet \
  -- set_staleness_bound \
  --seconds <NEW_BOUND>
```

### Rotating Signer Keys

1. Generate new keypair
2. Add new signer to contract:
   ```bash
   stellar contract invoke --id <ORACLE_CONTRACT_ID> \
     --source ADMIN_SECRET -- add_signer --signer <NEW_SIGNER>
   ```
3. Update backend `.env` with new secret
4. Deploy backend with new secret
5. Verify updates succeed with new key
6. Remove old signer from contract

### Emergency Pause

If oracle is compromised or malfunctioning:

```bash
# Pause oracle (stops updates and validations)
stellar contract invoke \
  --id <ORACLE_CONTRACT_ID> \
  --source ADMIN_SECRET \
  --network mainnet \
  -- set_paused \
  --paused true
```

Renewals will continue without FX validation during pause.

## Security Considerations

1. **Signer Key Protection**
   - Store signer secret in secure vault (AWS Secrets Manager, HashiCorp Vault)
   - Never commit secrets to git
   - Rotate keys periodically

2. **Rate Source Integrity**
   - Use multiple independent API sources
   - Implement deviation checks (reject outlier rates)
   - Log all rate sources used

3. **Admin Key Security**
   - Use hardware wallet or multi-sig for admin key
   - Require M-of-N signatures for critical operations
   - Implement timelocks for admin actions

4. **Network Security**
   - Use TLS for all API calls
   - Implement API key rotation
   - Rate limit outbound requests

## Performance Optimization

### Batch Updates

Submit multiple currency updates in a single transaction:

```typescript
// Instead of 10 separate transactions for 10 currencies,
// batch them into 1-2 transactions
const batchSize = 5;
for (let i = 0; i < updates.length; i += batchSize) {
  const batch = updates.slice(i, i + batchSize);
  await submitBatchUpdate(batch);
}
```

### Caching Strategy

- Cache rates in-memory with TTL
- Only submit to oracle if rate changed by > threshold (e.g., 0.1%)
- Implement staleness buffer (submit at 50% of staleness bound)

### Update Frequency Tuning

Balance freshness vs. cost:
- High-volatility pairs: Update every 5-15 minutes
- Stable pairs: Update every 30-60 minutes
- Monitor actual renewal rate vs. update cost

## Troubleshooting

### Rates Not Updating

**Check**:
1. `FX_ORACLE_ENABLED=true`?
2. Feeder started? Check logs for "Starting FX Oracle Feeder"
3. Signer authorized? Check contract with `get_signers`
4. External APIs responding? Check exchange rate service logs

### Renewals Failing with "Rate Stale"

**Cause**: Oracle staleness bound exceeded

**Fix**:
1. Check feeder is running
2. Reduce update interval
3. Increase staleness bound (if appropriate)
4. Check for network/API issues

### High Transaction Costs

**Optimize**:
1. Increase update interval (less frequent updates)
2. Batch multiple updates per transaction
3. Only update when rate changes significantly
4. Use cheaper network (testnet for testing)

## Future Improvements

- [ ] Multi-signature rate updates (require consensus from multiple feeders)
- [ ] Rate deviation alerts (flag unusual rate movements)
- [ ] Historical rate storage and analytics
- [ ] Automated cost optimization (dynamic update frequency)
- [ ] Backup feeder failover (secondary feeder takes over if primary fails)
