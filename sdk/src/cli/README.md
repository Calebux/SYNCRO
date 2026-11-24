# SYNCRO CLI Tools

## syncro-import-openapi

Import an OpenAPI specification and generate a pricing configuration file for SYNCRO providers.

### Installation

After building the SDK:

```bash
npm install -g @syncro/sdk
```

Or use directly from the package:

```bash
npx @syncro/sdk syncro-import-openapi <spec-file>
```

### Usage

```bash
syncro-import-openapi <spec-file> [options]
```

#### Arguments

- `<spec-file>` - Path to OpenAPI spec file (JSON format)

#### Options

- `-o, --output <file>` - Output file path (default: pricing.json)
- `--default-price <num>` - Default price per operation (default: 0.01)
- `-h, --help` - Show help message

### Examples

Basic usage:
```bash
syncro-import-openapi spec.json
```

Custom output and default price:
```bash
syncro-import-openapi spec.json -o my-pricing.json --default-price 0.05
```

### Vendor Extensions

The importer supports the `x-syncro-price` vendor extension to set custom pricing for specific operations:

```json
{
  "paths": {
    "/users": {
      "get": {
        "summary": "List users",
        "x-syncro-price": 0.02
      },
      "post": {
        "summary": "Create user",
        "x-syncro-price": 0.10
      }
    }
  }
}
```

### Output Format

The generated pricing file follows the SYNCRO provider pricing format:

```json
{
  "defaultPrice": 0.01,
  "currency": "USDC",
  "routes": {
    "GET /users": {
      "price": 0.02,
      "description": "List users"
    },
    "POST /users": {
      "price": 0.10,
      "description": "Create user"
    }
  }
}
```

### Current Limitations (1% Implementation)

- JSON format only (YAML support coming soon)
- Basic operation extraction (no parameter validation)
- No conflict detection for overlapping route patterns
- Simple pricing model (no unit-based pricing yet)

### Next Steps

After generating a pricing file:

1. Review and adjust the prices
2. Import the pricing in your provider configuration:
   ```typescript
   import { pricing } from '@syncro/sdk/provider';
   import pricingConfig from './pricing.json';
   
   const myPricing = pricing(pricingConfig);
   ```
3. Register your provider routes with SYNCRO
