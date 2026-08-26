#!/usr/bin/env node
/**
 * Generate TypeScript contract bindings from the shared ABI snapshot
 * (shared/src/generated/soroban-abi.json), or from a Soroban WASM ABI.
 *
 * Usage:
 *   node scripts/generate-contract-bindings.cjs [--wasm path/to/contract.wasm]
 */

const fs = require('fs');
const path = require('path');

const ABI_JSON = path.join(__dirname, '../../shared/src/generated/soroban-abi.json');
const OUTPUT_DIR = path.join(__dirname, '../src/generated');

const ARG_TYPE_MAP = {
  Address: 'string',
  String: 'string',
  U64: 'bigint',
  I128: 'bigint',
  BytesN32: 'Uint8Array',
  Bytes: 'Uint8Array',
  Bool: 'boolean',
  Option: 'unknown | null',
  Vec: 'unknown[]',
  U32: 'number',
};

function loadAbi() {
  if (!fs.existsSync(ABI_JSON)) {
    throw new Error(
      `Missing ${ABI_JSON}. Run: node scripts/generate-contract-types.mjs`,
    );
  }
  return JSON.parse(fs.readFileSync(ABI_JSON, 'utf8'));
}

async function extractFromWasm(wasmPath) {
  const { Spec } = require('@stellar/stellar-sdk/contract');
  const wasm = fs.readFileSync(wasmPath);
  const spec = Spec.fromWasm(wasm);
  const contractName = path.basename(wasmPath, '.wasm');

  return spec.funcs().map((fn) => {
    const inputArgs = fn.inputArgs();
    return {
      contract: contractName,
      name: fn.name().toString(),
      args: inputArgs.map((arg, i) => ({
        name: arg.name().toString() || `arg${i}`,
        type: mapXdrType(arg.type()),
      })),
    };
  });
}

function mapXdrType(typeDef) {
  const switchName = typeDef.switch?.()?.name ?? 'unknown';
  const mapping = {
    scSpecTypeU64: 'bigint',
    scSpecTypeI128: 'bigint',
    scSpecTypeString: 'string',
    scSpecTypeAddress: 'string',
    scSpecTypeBool: 'boolean',
    scSpecTypeBytes: 'Uint8Array',
    scSpecTypeOption: 'unknown | null',
    scSpecTypeVec: 'unknown[]',
    scSpecTypeU32: 'number',
  };
  return mapping[switchName] ?? 'unknown';
}

function extractFromAbi() {
  const abi = loadAbi();
  const functions = [];
  for (const iface of abi.contracts) {
    for (const fn of iface.functions) {
      functions.push({
        contract: iface.contract,
        name: fn.name,
        args: fn.args.map((arg, i) => ({
          name: arg.name || `arg${i}`,
          type: ARG_TYPE_MAP[arg.kind] ?? 'unknown',
        })),
      });
    }
  }
  return functions;
}

function toPascalCase(str) {
  return str
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function generateInterfaces(functions) {
  const lines = [
    '/**',
    ' * AUTO-GENERATED — do not edit manually.',
    ' * Source: shared/src/generated/soroban-abi.json',
    ' * Run: npm run generate:contracts -w sdk',
    ' */',
    '',
  ];

  const byContract = new Map();
  for (const fn of functions) {
    const list = byContract.get(fn.contract) ?? [];
    list.push(fn);
    byContract.set(fn.contract, list);
  }

  for (const [contract, fns] of byContract) {
    const ifaceName = `${toPascalCase(contract)}Contract`;
    lines.push(`export interface ${ifaceName} {`);
    for (const fn of fns) {
      const argsType = fn.args.length
        ? `{ ${fn.args.map((a) => `${a.name}: ${a.type}`).join('; ')} }`
        : 'Record<string, never>';
      lines.push(`  ${fn.name}(args: ${argsType}): Promise<unknown>;`);
    }
    lines.push('}');
    lines.push('');
  }

  lines.push('export interface GeneratedContractMap {');
  for (const contract of byContract.keys()) {
    lines.push(`  ${JSON.stringify(contract)}: ${toPascalCase(contract)}Contract;`);
  }
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function generateTransactionBuilders(functions) {
  const lines = [
    '/**',
    ' * AUTO-GENERATED typed transaction builder helpers.',
    ' * Source: shared/src/generated/soroban-abi.json',
    ' * Run: npm run generate:contracts -w sdk',
    ' */',
    '',
    "import type { GeneratedContractMap } from './contracts.js';",
    '',
    'export interface ContractInvokeParams<TArgs> {',
    '  contractId: string;',
    '  method: string;',
    '  args: TArgs;',
    '  sourceAccount: string;',
    '}',
    '',
    'export interface BuiltTransaction {',
    '  contractId: string;',
    '  method: string;',
    '  args: unknown;',
    '  sourceAccount: string;',
    '}',
    '',
    'export function buildContractInvoke<T extends keyof GeneratedContractMap>(',
    '  _contract: T,',
    '  method: string,',
    '  params: Omit<ContractInvokeParams<unknown>, "method">,',
    '): BuiltTransaction {',
    '  return {',
    '    contractId: params.contractId,',
    '    method,',
    '    args: params.args,',
    '    sourceAccount: params.sourceAccount,',
    '  };',
    '}',
    '',
  ];

  for (const fn of functions) {
    const builderName = `build${toPascalCase(fn.contract)}${toPascalCase(fn.name)}`;
    const argsType = fn.args.length
      ? `{ ${fn.args.map((a) => `${a.name}: ${a.type}`).join('; ')} }`
      : 'Record<string, never>';

    lines.push(`export function ${builderName}(`);
    lines.push('  contractId: string,');
    lines.push('  sourceAccount: string,');
    lines.push(`  args: ${argsType},`);
    lines.push('): BuiltTransaction {');
    lines.push('  return {');
    lines.push('    contractId,');
    lines.push(`    method: ${JSON.stringify(fn.name)},`);
    lines.push('    args,');
    lines.push('    sourceAccount,');
    lines.push('  };');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const wasmArgIdx = process.argv.indexOf('--wasm');
  const wasmPath = wasmArgIdx >= 0 ? process.argv[wasmArgIdx + 1] : undefined;

  let functions;
  if (wasmPath) {
    console.log(`Extracting ABI from WASM: ${wasmPath}`);
    functions = await extractFromWasm(wasmPath);
  } else {
    console.log('Using shared/src/generated/soroban-abi.json');
    functions = extractFromAbi();
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'contracts.ts'), generateInterfaces(functions));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'transaction-builders.ts'), generateTransactionBuilders(functions));
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.ts'),
    [
      '/** AUTO-GENERATED barrel export */',
      "export * from './contracts.js';",
      "export * from './transaction-builders.js';",
      '',
    ].join('\n'),
  );

  console.log(`Generated ${functions.length} contract methods in ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
