# FX Oracle Quick Start Guide

## TL;DR

The FX Oracle validates foreign exchange rates on-chain for multi-currency subscription renewals. This prevents manipulation of off-chain rate calculations.

## 5-Minute Setup (Testnet)

### 1. Deploy Oracle Contract

```bash
cd contracts
cargo build --release --target wasm32-unknown-unknown

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/fx_oracle.wasm \
  --source SADMIN_SECRET_KEY \
  --network testnet
# Returns: ORACLE_CONTRACT_ID
```

### 2. Initialize Oracle

```bash
# Set admin
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- init --admin GADMIN_ADDRESS

# Add rate feeder
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- add_signer --signer GFEEDER_ADDRESS

# Set staleness bound (1 hour)
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- set_staleness_bound --seconds 3600
```

### 3. Link to Renewal Contract

```bash
stellar contract invoke --id RENEWAL_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- set_fx_oracle_contract --address ORACLE_CONTRACT_ID
```

### 4. Configure Backend

```bash
# Add to .env
FX_ORACLE_ENABLED=true
FX_ORACLE_CONTRACT_ADDRESS=ORACLE_CONTRACT_ID
FX_ORACLE_SIGNER_SECRET=SFEEDER_SECRET_KEY
FX_ORACLE_UPDATE_INTERVAL=900000
FX_ORACLE_CURRENCIES=EUR,GBP,JPY,CAD,AUD
FX_ORACLE_BASE_CURRENCY=USD
```

### 5. Start Backend

```bash
npm run start
# Watch logs for: "Starting FX Oracle Feeder..."
```

## Testing

```bash
# Run contract tests
cd contracts
cargo test --package fx-oracle

# Run backend tests
cd backend
npm test fx-oracle-feeder

# Manual rate update
curl -X POST http://localhost:3000/api/admin/oracle/trigger-update \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

## How It Works

```
┌────────────────┐
│ Backend Feeder │  Fetches rates from APIs every 15 min
│   (Service)    │  Submits to oracle contract
└────────┬───────┘
         │ update_rate(USD, EUR, 92000000, timestamp)
         ▼
┌────────────────┐
│  FX Oracle     │  Stores rates with timestamps
│  (Contract)    │  Validates freshness on query
└────────┬───────┘
         │ validate_rate(EUR, USD) → Ok(rate_data)
         ▼
┌────────────────┐
│ Subscription   │  Validates FX conversion before renewal
│ Renewal        │  Rejects if rate stale or not found
│  (Contract)    │
└────────────────┘
```

## Key Commands

### Query Oracle

```bash
# Get rate
stellar contract invoke --id ORACLE_CONTRACT_ID --network testnet \
  -- get_rate --base_currency USD --quote_currency EUR

# Validate rate (checks freshness)
stellar contract invoke --id ORACLE_CONTRACT_ID --network testnet \
  -- validate_rate --base_currency USD --quote_currency EUR

# Get signers
stellar contract invoke --id ORACLE_CONTRACT_ID --network testnet \
  -- get_signers

# Get staleness bound
stellar contract invoke --id ORACLE_CONTRACT_ID --network testnet \
  -- get_staleness_bound
```

### Update Rate (Authorized Signer Only)

```bash
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SFEEDER_SECRET_KEY --network testnet \
  -- update_rate \
  --base_currency USD \
  --quote_currency EUR \
  --rate 92000000 \
  --timestamp $(date +%s)
```

### Admin Operations

```bash
# Add signer
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- add_signer --signer GNEW_SIGNER_ADDRESS

# Remove signer
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- remove_signer --signer GOLD_SIGNER_ADDRESS

# Update staleness bound (2 hours)
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- set_staleness_bound --seconds 7200

# Pause oracle (emergency)
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- set_paused --paused true
```

## Rate Format

Rates use **8 decimal fixed-point** notation:

| Actual Rate | Fixed-Point | Calculation |
|-------------|-------------|-------------|
| 0.92 EUR/USD | 92,000,000 | 0.92 × 10^8 |
| 1.09 USD/EUR | 109,000,000 | 1.09 × 10^8 |
| 145.5 JPY/USD | 14,550,000,000 | 145.5 × 10^8 |
| 0.0001 XLM/USD | 10,000 | 0.0001 × 10^8 |

## Common Issues

### "Rate is stale"

**Cause**: Rate older than staleness bound

**Fix**:
```bash
# Check last update time
stellar contract invoke --id ORACLE_CONTRACT_ID --network testnet \
  -- get_rate --base_currency USD --quote_currency EUR
# Look at "timestamp" field

# Manually trigger update
curl -X POST http://localhost:3000/api/admin/oracle/trigger-update

# Or increase staleness bound temporarily
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- set_staleness_bound --seconds 7200
```

### "Unauthorized signer"

**Cause**: Feeder not authorized

**Fix**:
```bash
# Check current signers
stellar contract invoke --id ORACLE_CONTRACT_ID --network testnet \
  -- get_signers

# Add feeder
stellar contract invoke --id ORACLE_CONTRACT_ID \
  --source SADMIN_SECRET_KEY --network testnet \
  -- add_signer --signer GFEEDER_ADDRESS
```

### Backend not updating

**Cause**: Service not started or misconfigured

**Fix**:
```bash
# Check environment
echo $FX_ORACLE_ENABLED  # Should be "true"
echo $FX_ORACLE_CONTRACT_ADDRESS  # Should be contract ID

# Check logs
tail -f logs/app.log | grep "FX Oracle"

# Restart service
npm run restart
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/health/oracle
```

Expected response:
```json
{
  "enabled": true,
  "contractAddress": "ORACLE_CONTRACT_ID",
  "currencies": ["EUR", "GBP", "JPY", "CAD", "AUD"],
  "updateInterval": 900000,
  "ratesFreshness": "fresh",
  "ratesAgeMs": 120000
}
```

### Watch Logs

```bash
# Oracle feeder logs
tail -f logs/app.log | grep "FX Oracle"

# Successful update
# "FX Oracle rate update completed" { successCount: 5, failureCount: 0 }

# Failed update
# "Oracle update failed for currency" { currency: "EUR", error: "..." }
```

## Security Checklist

- [ ] Admin key stored securely (hardware wallet or vault)
- [ ] Signer key rotated periodically
- [ ] Staleness bound appropriate for your use case
- [ ] Multiple independent rate feeders configured
- [ ] Monitoring alerts configured
- [ ] Emergency pause procedure documented
- [ ] Rate source API keys secured

## Full Documentation

- **Oracle Contract**: `contracts/contracts/fx-oracle/README.md`
- **Backend Integration**: `backend/docs/FX_ORACLE_INTEGRATION.md`
- **Implementation Summary**: `FX_ORACLE_IMPLEMENTATION_SUMMARY.md`

## Support

For issues or questions:
1. Check logs: `tail -f logs/app.log | grep "oracle"`
2. Review events on-chain: Check contract events in explorer
3. Test with manual update: `curl -X POST .../trigger-update`
4. Consult full documentation (links above)
