# SYNCRO Cloudflare Worker Example

A minimal example demonstrating SYNCRO's metered API on Cloudflare Workers using WebCrypto (no Node.js built-ins).

## Features

- ✅ WebCrypto-only implementation (Workers-native)
- ✅ 402 Payment Required responses
- ✅ Payment proof verification
- ✅ Receipt generation
- ✅ Multiple pricing tiers
- ✅ Free and paid endpoints
- ⚠️ Optional Durable Objects support (placeholder)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Locally

```bash
npm run dev
```

The worker will be available at http://localhost:8787

### 3. Test Endpoints

#### Free Endpoint (No Payment Required)

```bash
curl http://localhost:8787/
```

#### Paid Endpoint (Returns 402 without payment)

```bash
curl -v http://localhost:8787/api/hello
```

Expected response: `402 Payment Required` with `PAYMENT-REQUIRED` header

#### Paid Endpoint (With Mock Payment Proof)

```bash
curl http://localhost:8787/api/hello \
  -H "X-Syncro-Payment-Proof: mock-payment-proof-abc123"
```

Expected response: `200 OK` with `X-Syncro-Receipt` header containing receipt

## API Endpoints

| Endpoint          | Method | Price  | Description              |
|-------------------|--------|--------|--------------------------|
| `/`               | GET    | Free   | API information          |
| `/health`         | GET    | Free   | Health check             |
| `/api/hello`      | GET    | $0.01  | Hello world              |
| `/api/data`       | POST   | $0.05  | Data processing          |
| `/api/premium`    | GET    | $0.10  | Premium content          |

## Payment Flow

1. **Request without payment proof**:
   ```
   GET /api/hello
   → 402 Payment Required
   → PAYMENT-REQUIRED header with payment details
   ```

2. **Request with valid payment proof**:
   ```
   GET /api/hello
   X-Syncro-Payment-Proof: <proof>
   → 200 OK
   → X-Syncro-Receipt header with receipt
   → Response body
   ```

## Project Structure

```
examples/cloudflare-worker/
├── worker.ts           # Main Worker implementation
├── wrangler.toml       # Wrangler configuration
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
└── README.md           # This file
```

## Deployment

### Deploy to Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Deploy to production
npm run deploy
```

### Configure Custom Domain (Optional)

Update `wrangler.toml`:

```toml
[env.production]
routes = [
  { pattern = "api.example.com/*", zone_name = "example.com" }
]
```

## Advanced Features (Future)

### Durable Objects for Reservation State

Uncomment in `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "RESERVATIONS"
class_name = "ReservationStore"
script_name = "syncro-worker-example"
```

### KV Storage for Receipts

Uncomment in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RECEIPTS"
id = "your-kv-namespace-id"
```

## Development Notes

### WebCrypto Compatibility

This example uses only Workers-native APIs:
- `crypto.subtle` for cryptographic operations
- No Node.js `crypto` module imports
- Compatible with `sdk/scripts/assert-no-node-crypto.mjs`

### Testing

```bash
# Run type checking
npm run typecheck

# Run tests (when implemented)
npm test
```

## Current Limitations (1% Implementation)

- ⚠️ Payment proof verification is stubbed (basic format check)
- ⚠️ No real Ed25519 signature verification yet
- ⚠️ No Durable Objects integration yet
- ⚠️ No SYNCRO gateway integration yet

## Next Steps

To complete the full implementation:

1. **Real Crypto Verification** (10%): Implement Ed25519 signature verification using `crypto.subtle`
2. **Durable Objects Integration** (20%): Add reservation state storage
3. **Gateway Integration** (30%): Connect to SYNCRO payment gateway
4. **Advanced Metering** (40%): Token/byte/second-based pricing

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [SYNCRO Documentation](https://docs.syncro.dev)
- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

## License

MIT
