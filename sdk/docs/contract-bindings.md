# Soroban Contract TypeScript Bindings

Auto-generated TypeScript interfaces and transaction builders for SYNCRO Soroban contracts.

## Generating bindings

From the repo root:

```bash
# From canonical interfaces (default)
npm run generate:contracts -w sdk

# From compiled WASM (extracts ABI via @stellar/stellar-sdk)
node sdk/scripts/generate-contract-bindings.cjs --wasm contracts/target/wasm32-unknown-unknown/release/<contract>.wasm
```

Generated files are written to `sdk/src/generated/` and included in the SDK build via `prebuild`.

## Usage

```typescript
import {
  buildContractInvoke,
  type BuiltTransaction,
} from '@syncro/sdk/contracts';

const tx: BuiltTransaction = buildContractInvoke(
  'CCONTRACTID...',
  'methodName',
  {
    contractId: 'CCONTRACTID...',
    method: 'methodName',
    args: { arg0: 'value' },
    sourceAccount: 'GUSERACCOUNT...',
  },
);

// Submit via backend API or Stellar SDK Contract client
console.log(tx.method, tx.args);
```

## Exports

| Export | Description |
|--------|-------------|
| `@syncro/sdk/contracts` | Generated interfaces + typed transaction builders |
| `GeneratedContractMap` | Map of contract name → interface |
| `buildContractInvoke` | Generic typed invoke builder |
| `ContractInvokeParams<TArgs>` | Typed parameters for `buildContractInvoke` |
| `BuiltTransaction` | Result of `buildContractInvoke` |
