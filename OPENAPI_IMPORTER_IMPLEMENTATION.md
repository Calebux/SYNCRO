# OpenAPI Importer CLI - 1% Implementation

## Overview

This PR implements the first 1% of issue #1698: a basic CLI tool to import OpenAPI specifications and generate SYNCRO pricing configuration files.

## What Was Implemented

### Core Functionality

1. **CLI Command**: `syncro-import-openapi`
   - Location: `sdk/src/cli/import-openapi.ts`
   - Binary entry: Added to `sdk/package.json` bin field
   - Build config: Added to `sdk/tsup.config.ts`

2. **Features**:
   - ✅ Reads OpenAPI 3.x/Swagger JSON specs
   - ✅ Extracts all HTTP operations (GET, POST, PUT, PATCH, DELETE, etc.)
   - ✅ Generates valid SYNCRO pricing configuration files
   - ✅ Supports `x-syncro-price` vendor extension for custom pricing
   - ✅ Includes operation descriptions in output
   - ✅ Configurable default price via CLI flag
   - ✅ Help documentation (`--help`)

3. **Testing**:
   - Sample petstore OpenAPI spec: `sdk/test-fixtures/petstore.json`
   - Expected output: `sdk/test-fixtures/expected-pricing.json`
   - Basic test suite: `sdk/src/cli/__tests__/import-openapi.test.ts`
   - Documentation: `sdk/src/cli/README.md`

## Usage

```bash
# Install from the SDK package
npm install -g @syncro/sdk

# Import an OpenAPI spec
syncro-import-openapi spec.json

# With custom output and pricing
syncro-import-openapi spec.json -o pricing.json --default-price 0.05
```

## Example

**Input** (`petstore.json`):
```json
{
  "openapi": "3.1.0",
  "paths": {
    "/pets": {
      "get": {
        "summary": "List all pets"
      },
      "post": {
        "summary": "Create a pet",
        "x-syncro-price": 0.05
      }
    }
  }
}
```

**Output** (`pricing.json`):
```json
{
  "defaultPrice": 0.01,
  "currency": "USDC",
  "routes": {
    "GET /pets": {
      "price": 0.01,
      "description": "List all pets"
    },
    "POST /pets": {
      "price": 0.05,
      "description": "Create a pet"
    }
  }
}
```

## Vendor Extension: x-syncro-price

Providers can set custom pricing directly in their OpenAPI spec:

```json
{
  "paths": {
    "/expensive-operation": {
      "post": {
        "summary": "Complex AI operation",
        "x-syncro-price": 0.50
      }
    }
  }
}
```

This price overrides the default and appears in the generated pricing file.

## Current Limitations (Future Work)

The following are intentionally not implemented in this 1% version:

- ❌ **YAML support**: Only JSON specs are supported (YAML parser needed)
- ❌ **Route conflict detection**: No validation for overlapping path patterns (#1698)
- ❌ **Unit-based pricing**: Only simple per-call pricing (no tokens/bytes/seconds)
- ❌ **Quantity extractors**: No support for `maxBillableUnits` or extractors
- ❌ **Rate limiting**: No rate limit configuration import
- ❌ **Advanced path matching**: No wildcard or regex pattern support
- ❌ **Provider registration**: No automatic route registration (manual step required)

## Integration with SYNCRO

After generating a pricing file, providers can use it in their configuration:

```typescript
import { pricing } from '@syncro/sdk/provider';
import pricingConfig from './pricing.json';

// Create pricing object
const myPricing = pricing(pricingConfig);

// Use when registering routes
const route = myPricing.match('GET', '/pets');
console.log(route.price); // 0.01
```

## Files Changed

```
M  sdk/package.json                               # Added CLI bin entry
M  sdk/tsup.config.ts                            # Added build entry
A  sdk/src/cli/import-openapi.ts                 # Main CLI implementation
A  sdk/src/cli/README.md                         # CLI documentation
A  sdk/src/cli/__tests__/import-openapi.test.ts  # Test suite
A  sdk/test-fixtures/petstore.json               # Sample OpenAPI spec
A  sdk/test-fixtures/expected-pricing.json       # Expected output
```

## Next Steps

To complete issue #1698, the following should be implemented:

1. **YAML Support** (next 10%): Add yaml parser dependency and support
2. **Route Conflict Detection** (next 20%): Validate path pattern precedence
3. **Advanced Pricing** (next 30%): Support units, extractors, rate limits
4. **Provider Registration** (remaining 39%): Direct API integration

## Testing

```bash
# After building the SDK
cd sdk
npm run build

# Test the CLI
./dist/cli/import-openapi.js test-fixtures/petstore.json

# Run tests
npm test -- import-openapi
```

## Branch

- Branch: `feature/openapi-importer-cli`
- Fork: https://github.com/coderolisa/SYNCRO.git
- Ready for PR creation

## Acceptance Criteria Met

- ✅ Importing a sample petstore spec produces a valid pricing file
- ✅ Vendor extensions (`x-syncro-price`) are respected
- ⚠️ Route conflict detection flagged as future work (not in 1% scope)
