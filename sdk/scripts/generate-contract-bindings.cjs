#!/usr/bin/env node
/**
 * generate-contract-bindings.cjs
 *
 * Generates TypeScript bindings from the built Soroban WASM ABI (preferred)
 * or from the canonical SOROBAN_CONTRACT_INTERFACES definition (fallback).
 *
 * Usage:
 *   # from WASM (authoritative — run after `cargo build`):
 *   node scripts/generate-contract-bindings.cjs --wasm-dir contracts/target/wasm32-unknown-unknown/release
 *
 *   # from canonical interfaces (no Rust toolchain needed):
 *   node scripts/generate-contract-bindings.cjs
 *
 * The generated files carry a version stamp so that a mismatch between the
 * committed bindings and a fresh generation is detectable at build-time and
 * at runtime.
 *
 * Issue #1300 — bindings are generated, never hand-written.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SDK_ROOT  = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(SDK_ROOT, 'src', 'generated');

// ─────────────────────────────────────────────────────────────────────────────
// Shared interfaces fallback (no WASM required)
// ─────────────────────────────────────────────────────────────────────────────

let SOROBAN_CONTRACT_INTERFACES;
try {
  ({ SOROBAN_CONTRACT_INTERFACES } = require(
    path.join(REPO_ROOT, 'shared', 'dist', 'soroban-contract-interfaces.js'),
  ));
} catch (_) {
  // If the shared package hasn't been built yet, use the raw TS source via a
  // lightweight inline parse so CI doesn't need a pre-build step.
  SOROBAN_CONTRACT_INTERFACES = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// WASM ABI extraction
// ─────────────────────────────────────────────────────────────────────────────

const ARG_TYPE_MAP = {
  Address:   'string',
  String:    'string',
  U64:       'bigint',
  I128:      'bigint',
  BytesN32:  'Uint8Array',
  Bool:      'boolean',
  Option:    'unknown | null',
  Vec:       'unknown[]',
};

/**
 * Resolve a Soroban XDR type tag to a TS type string.
 */
function mapXdrType(typeDef) {
  const switchName = typeDef.switch?.()?.name ?? 'unknown';
  const mapping = {
    scSpecTypeU64:     'bigint',
    scSpecTypeI128:    'bigint',
    scSpecTypeString:  'string',
    scSpecTypeAddress: 'string',
    scSpecTypeBool:    'boolean',
    scSpecTypeBytes:   'Uint8Array',
    scSpecTypeOption:  'unknown | null',
    scSpecTypeVec:     'unknown[]',
  };
  return mapping[switchName] ?? 'unknown';
}

/**
 * Extract function metadata from a compiled WASM artifact.
 * Requires @stellar/stellar-sdk to be installed.
 */
async function extractFromWasm(wasmPath) {
  const { Spec } = require('@stellar/stellar-sdk/contract');
  const wasm = fs.readFileSync(wasmPath);
  const spec = Spec.fromWasm(wasm);
  const contractName = toPascalCase(path.basename(wasmPath, '.wasm'));

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

/**
 * Scan a directory for .wasm files and extract all function specs.
 */
async function extractFromWasmDir(wasmDir) {
  const files = fs.readdirSync(wasmDir).filter((f) => f.endsWith('.wasm'));
  if (files.length === 0) {
    throw new Error(`No .wasm files found in ${wasmDir}`);
  }
  const all = [];
  for (const file of files) {
    const funcs = await extractFromWasm(path.join(wasmDir, file));
    all.push(...funcs);
  }
  return all;
}

/**
 * Extract function metadata from the canonical SOROBAN_CONTRACT_INTERFACES
 * shared definition (no Rust/WASM toolchain required).
 */
function extractFromInterfaces() {
  if (!SOROBAN_CONTRACT_INTERFACES) {
    throw new Error(
      'SOROBAN_CONTRACT_INTERFACES not available. Either build the shared package first ' +
      'or pass --wasm-dir to generate from WASM.',
    );
  }
  const functions = [];
  for (const iface of SOROBAN_CONTRACT_INTERFACES) {
    for (const fn of iface.functions) {
      functions.push({
        contract: iface.contract,
        name: fn.name,
        args: fn.args.map((arg, i) => ({
          name: `arg${i}`,
          type: ARG_TYPE_MAP[arg] ?? 'unknown',
        })),
      });
    }
  }
  return functions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Version stamp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic hash of the function list.  This becomes the
 * "contract version" stamped into the generated files so that any change
 * to the contract interface is detectable at build-time and at runtime.
 */
function computeBindingsHash(functions) {
  const canonical = JSON.stringify(
    functions.map((f) => ({
      contract: f.contract,
      name: f.name,
      args: f.args.map((a) => ({ name: a.name, type: a.type })),
    })),
    null,
    0,
  );
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Code generation
// ─────────────────────────────────────────────────────────────────────────────

function toPascalCase(str) {
  return str
    .split(/[_\-\s]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function generateInterfaces(functions, bindingsHash, source) {
  const lines = [
    '/**',
    ' * AUTO-GENERATED — do not edit manually.',
    ` * Source: ${source}`,
    ` * Bindings hash: ${bindingsHash}`,
    ' * Run: npm run generate:contracts -w sdk',
    ' *',
    ' * CONTRACT_BINDINGS_VERSION is exported so the SDK can warn at runtime',
    ' * when loaded bindings do not match the version the backend was built against.',
    ' */',
    '',
    `export const CONTRACT_BINDINGS_VERSION = ${JSON.stringify(bindingsHash)};`,
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

function generateTransactionBuilders(functions, bindingsHash, source) {
  const lines = [
    '/**',
    ' * AUTO-GENERATED typed transaction builder helpers.',
    ` * Source: ${source}`,
    ` * Bindings hash: ${bindingsHash}`,
    ' * Run: npm run generate:contracts -w sdk',
    ' */',
    '',
    "import type { GeneratedContractMap } from './contracts.js';",
    "export { CONTRACT_BINDINGS_VERSION } from './contracts.js';",
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

// ─────────────────────────────────────────────────────────────────────────────
// Stale-check mode (used by CI)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the stored bindings hash from the committed contracts.ts file.
 */
function readCommittedHash() {
  const contractsTs = path.join(OUTPUT_DIR, 'contracts.ts');
  if (!fs.existsSync(contractsTs)) return null;
  const source = fs.readFileSync(contractsTs, 'utf8');
  const m = source.match(/Bindings hash:\s*([a-f0-9]{16})/);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const wasmDirIdx = args.indexOf('--wasm-dir');
  const wasmDir = wasmDirIdx >= 0 ? args[wasmDirIdx + 1] : undefined;

  // Legacy single-file --wasm flag
  const wasmArgIdx = args.indexOf('--wasm');
  const wasmFile = wasmArgIdx >= 0 ? args[wasmArgIdx + 1] : undefined;

  let functions;
  let source;

  if (wasmDir) {
    console.log(`Extracting ABI from WASM directory: ${wasmDir}`);
    functions = await extractFromWasmDir(wasmDir);
    source = `WASM ABI (${wasmDir})`;
  } else if (wasmFile) {
    console.log(`Extracting ABI from WASM file: ${wasmFile}`);
    functions = await extractFromWasm(wasmFile);
    source = `WASM ABI (${wasmFile})`;
  } else {
    console.log('No --wasm-dir provided; using SOROBAN_CONTRACT_INTERFACES from @syncro/shared');
    functions = extractFromInterfaces();
    source = 'SOROBAN_CONTRACT_INTERFACES (@syncro/shared)';
  }

  const bindingsHash = computeBindingsHash(functions);

  if (checkOnly) {
    const committed = readCommittedHash();
    if (committed === null) {
      console.error('ERROR: Could not find a committed bindings hash in sdk/src/generated/contracts.ts');
      console.error('Run `npm run generate:contracts -w sdk` to generate the bindings first.');
      process.exit(1);
    }
    if (committed !== bindingsHash) {
      console.error('');
      console.error('Bindings are STALE');
      console.error('──────────────────────────────────────────────────────────');
      console.error(`  Committed hash : ${committed}`);
      console.error(`  Fresh hash     : ${bindingsHash}`);
      console.error('');
      console.error('The contract interfaces changed but the generated TypeScript bindings');
      console.error('were not regenerated.  Run:');
      console.error('');
      console.error('  npm run generate:contracts -w sdk');
      console.error('');
      console.error('Then commit the updated files in sdk/src/generated/.');
      process.exit(1);
    }
    console.log(`Bindings are UP TO DATE (hash: ${bindingsHash})`);
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'contracts.ts'),
    generateInterfaces(functions, bindingsHash, source),
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'transaction-builders.ts'),
    generateTransactionBuilders(functions, bindingsHash, source),
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.ts'),
    [
      `/** AUTO-GENERATED barrel export — Bindings hash: ${bindingsHash} */`,
      "export * from './contracts.js';",
      "export * from './transaction-builders.js';",
      '',
    ].join('\n'),
  );

  console.log(`Generated ${functions.length} contract methods in ${OUTPUT_DIR}`);
  console.log(`Bindings hash: ${bindingsHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
