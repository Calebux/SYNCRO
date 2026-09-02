#!/usr/bin/env node
/**
 * Generate shared contract interface types from the canonical ABI snapshot.
 *
 * The ABI JSON is the shared input for:
 *   - shared/src/generated/contracts.ts
 *   - sdk contract bindings (sdk/scripts/generate-contract-bindings.cjs)
 *
 * Prefer WASM when --wasm <path> is given (or CONTRACT_WASM_DIR is set).
 * Otherwise keep/update the committed ABI snapshot and emit TypeScript from it.
 *
 * Also verifies every ABI function name still exists in the listed Rust source
 * so CI fails when a contract export is renamed or removed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ABI_JSON = path.join(ROOT, 'shared', 'src', 'generated', 'soroban-abi.json');
const OUTPUT_TS = path.join(ROOT, 'shared', 'src', 'generated', 'contracts.ts');

const ARG_KIND_TO_TS = {
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

const SEED_ABI = {
  contracts: [
    {
      contract: 'SubscriptionRegistry',
      source: 'contracts/contracts/src/subscription_registry.rs',
      functions: [
        {
          name: 'create_subscription',
          args: [
            { name: 'user', kind: 'Address' },
            { name: 'service_id', kind: 'String' },
            { name: 'billing_interval', kind: 'U64' },
            { name: 'expected_amount', kind: 'I128' },
            { name: 'next_renewal', kind: 'U64' },
          ],
        },
        {
          name: 'update_subscription',
          args: [
            { name: 'subscription_id', kind: 'BytesN32' },
            { name: 'user', kind: 'Address' },
            { name: 'service_id', kind: 'Option' },
            { name: 'billing_interval', kind: 'Option' },
            { name: 'expected_amount', kind: 'Option' },
            { name: 'next_renewal', kind: 'Option' },
          ],
        },
        {
          name: 'cancel_subscription',
          args: [
            { name: 'subscription_id', kind: 'BytesN32' },
            { name: 'caller', kind: 'Address' },
          ],
        },
      ],
    },
    {
      contract: 'SubscriptionLogging',
      source: 'contracts/contracts/subscription_logging/src/lib.rs',
      functions: [
        {
          name: 'record_log',
          args: [
            { name: 'sub_id', kind: 'U64' },
            { name: 'event', kind: 'String' },
            { name: 'data', kind: 'String' },
          ],
        },
      ],
    },
    {
      contract: 'SubscriptionRenewal',
      source: 'contracts/contracts/subscription_renewal/src/lib.rs',
      functions: [
        {
          name: 'renew',
          args: [
            { name: 'owner', kind: 'Address' },
            { name: 'sub_id', kind: 'U64' },
            { name: 'approval_id', kind: 'U64' },
            { name: 'amount', kind: 'I128' },
            { name: 'max_retries', kind: 'U64' },
            { name: 'cooldown_ledgers', kind: 'U64' },
            { name: 'cycle_id', kind: 'U64' },
            { name: 'succeed', kind: 'Bool' },
          ],
        },
      ],
    },
  ],
};

function mapXdrType(typeDef) {
  const switchName = typeDef.switch?.()?.name ?? 'unknown';
  const mapping = {
    scSpecTypeU64: 'U64',
    scSpecTypeI128: 'I128',
    scSpecTypeU32: 'U32',
    scSpecTypeString: 'String',
    scSpecTypeAddress: 'Address',
    scSpecTypeBool: 'Bool',
    scSpecTypeBytes: 'Bytes',
    scSpecTypeOption: 'Option',
    scSpecTypeVec: 'Vec',
  };
  if (mapping[switchName]) return mapping[switchName];
  if (String(switchName).includes('BytesN')) return 'BytesN32';
  return 'String';
}

async function extractFromWasm(wasmPath) {
  const { Spec } = require('@stellar/stellar-sdk/contract');
  const wasm = fs.readFileSync(wasmPath);
  const spec = Spec.fromWasm(wasm);
  const contractName = path.basename(wasmPath, '.wasm');
  return {
    contract: contractName,
    source: path.relative(ROOT, wasmPath),
    functions: spec.funcs().map((fn) => {
      const inputArgs = fn.inputArgs();
      return {
        name: fn.name().toString(),
        args: inputArgs.map((arg, i) => ({
          name: arg.name().toString() || `arg${i}`,
          kind: mapXdrType(arg.type()),
        })),
      };
    }),
  };
}

function rustFunctionNames(sourceRel) {
  const abs = path.join(ROOT, sourceRel);
  if (!fs.existsSync(abs)) return new Set();
  const src = fs.readFileSync(abs, 'utf8');
  const names = new Set();
  const re = /pub\s+fn\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return names;
}

function assertFunctionsExistInRust(abi) {
  const missing = [];
  for (const contract of abi.contracts) {
    const names = rustFunctionNames(contract.source);
    if (names.size === 0) {
      missing.push(`${contract.contract}: source not found (${contract.source})`);
      continue;
    }
    for (const fn of contract.functions) {
      if (!names.has(fn.name)) {
        missing.push(`${contract.contract}.${fn.name} missing from ${contract.source}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Contract ABI is stale relative to Rust sources:\n  - ${missing.join('\n  - ')}`,
    );
  }
}

function toPascalCase(str) {
  return str
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function emitContractsTs(abi) {
  const kinds = new Set();
  for (const c of abi.contracts) {
    for (const fn of c.functions) {
      for (const arg of fn.args) kinds.add(arg.kind);
    }
  }
  const kindUnion = [...kinds].sort().map((k) => `'${k}'`).join('\n  | ');

  const lines = [
    '/**',
    ' * AUTO-GENERATED — do not edit manually.',
    ' * Source: shared/src/generated/soroban-abi.json (WASM ABI when provided).',
    ' * Shared with sdk/scripts/generate-contract-bindings.cjs',
    ' * Regenerate: npm run generate:contracts -w shared',
    ' */',
    '',
    '/** Soroban ScVal argument kinds (subset used by SYNCRO contracts). */',
    `export type SorobanArgKind =`,
    `  | ${kindUnion};`,
    '',
    'export interface SorobanNamedArg {',
    '  name: string;',
    '  kind: SorobanArgKind;',
    '}',
    '',
    'export interface SorobanContractFunction {',
    '  /** Soroban export name (snake_case). */',
    '  name: string;',
    '  /** Ordered argument kinds as declared in the ABI. */',
    '  args: SorobanArgKind[];',
    '  namedArgs: SorobanNamedArg[];',
    '}',
    '',
    'export interface SorobanContractInterface {',
    '  contract: string;',
    '  source: string;',
    '  functions: SorobanContractFunction[];',
    '}',
    '',
    'export const SOROBAN_CONTRACT_INTERFACES: SorobanContractInterface[] = [',
  ];

  for (const contract of abi.contracts) {
    lines.push('  {');
    lines.push(`    contract: ${JSON.stringify(contract.contract)},`);
    lines.push(`    source: ${JSON.stringify(contract.source)},`);
    lines.push('    functions: [');
    for (const fn of contract.functions) {
      const kindsList = fn.args.map((a) => JSON.stringify(a.kind)).join(', ');
      const named = fn.args
        .map((a) => `{ name: ${JSON.stringify(a.name)}, kind: ${JSON.stringify(a.kind)} }`)
        .join(', ');
      lines.push('      {');
      lines.push(`        name: ${JSON.stringify(fn.name)},`);
      lines.push(`        args: [${kindsList}],`);
      lines.push(`        namedArgs: [${named}],`);
      lines.push('      },');
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('];');
  lines.push('');
  lines.push('/** Lookup a function definition by contract name and Soroban method name. */');
  lines.push('export function findContractFunction(');
  lines.push('  contract: string,');
  lines.push('  method: string,');
  lines.push('): SorobanContractFunction | undefined {');
  lines.push('  const iface = SOROBAN_CONTRACT_INTERFACES.find((c) => c.contract === contract);');
  lines.push('  return iface?.functions.find((fn) => fn.name === method);');
  lines.push('}');
  lines.push('');
  lines.push('/** Flat set of all declared Soroban method names (for quick membership checks). */');
  lines.push('export function allContractMethodNames(): Set<string> {');
  lines.push('  const names = new Set<string>();');
  lines.push('  for (const iface of SOROBAN_CONTRACT_INTERFACES) {');
  lines.push('    for (const fn of iface.functions) names.add(fn.name);');
  lines.push('  }');
  lines.push('  return names;');
  lines.push('}');
  lines.push('');

  for (const contract of abi.contracts) {
    const ifaceName = `${toPascalCase(contract.contract)}Contract`;
    lines.push(`export interface ${ifaceName} {`);
    for (const fn of contract.functions) {
      const argsType = fn.args.length
        ? `{ ${fn.args.map((a) => `${a.name}: ${ARG_KIND_TO_TS[a.kind] ?? 'unknown'}`).join('; ')} }`
        : 'Record<string, never>';
      lines.push(`  ${fn.name}(args: ${argsType}): Promise<unknown>;`);
    }
    lines.push('}');
    lines.push('');
  }

  lines.push('export interface GeneratedContractMap {');
  for (const contract of abi.contracts) {
    lines.push(
      `  ${JSON.stringify(contract.contract)}: ${toPascalCase(contract.contract)}Contract;`,
    );
  }
  lines.push('}');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function loadCommittedAbi() {
  if (fs.existsSync(ABI_JSON)) {
    return JSON.parse(fs.readFileSync(ABI_JSON, 'utf8'));
  }
  return SEED_ABI;
}

async function resolveAbi() {
  const wasmArgIdx = process.argv.indexOf('--wasm');
  const wasmPath = wasmArgIdx >= 0 ? process.argv[wasmArgIdx + 1] : undefined;
  const wasmDir = process.env.CONTRACT_WASM_DIR;

  if (wasmPath) {
    console.log(`Extracting ABI from WASM: ${wasmPath}`);
    const extracted = await extractFromWasm(wasmPath);
    const committed = loadCommittedAbi();
    const rest = committed.contracts.filter((c) => c.contract !== extracted.contract);
    return { contracts: [...rest, extracted] };
  }

  if (wasmDir && fs.existsSync(wasmDir)) {
    const files = fs.readdirSync(wasmDir).filter((f) => f.endsWith('.wasm'));
    if (files.length > 0) {
      console.log(`Extracting ABI from ${files.length} WASM files in ${wasmDir}`);
      const contracts = [];
      for (const file of files) {
        contracts.push(await extractFromWasm(path.join(wasmDir, file)));
      }
      return { contracts };
    }
  }

  return loadCommittedAbi();
}

async function main() {
  const abi = await resolveAbi();
  assertFunctionsExistInRust(abi);
  fs.mkdirSync(path.dirname(ABI_JSON), { recursive: true });
  fs.writeFileSync(ABI_JSON, `${JSON.stringify(abi, null, 2)}\n`);
  fs.writeFileSync(OUTPUT_TS, emitContractsTs(abi));
  const fnCount = abi.contracts.reduce((n, c) => n + c.functions.length, 0);
  console.log(
    `Wrote ${abi.contracts.length} contracts / ${fnCount} functions → ${path.relative(ROOT, ABI_JSON)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
