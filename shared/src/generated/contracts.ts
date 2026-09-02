/**
 * AUTO-GENERATED — do not edit manually.
 * Source: shared/src/generated/soroban-abi.json (WASM ABI when provided).
 * Shared with sdk/scripts/generate-contract-bindings.cjs
 * Regenerate: npm run generate:contracts -w shared
 */

/** Soroban ScVal argument kinds (subset used by SYNCRO contracts). */
export type SorobanArgKind =
  | 'Address'
  | 'Bool'
  | 'BytesN32'
  | 'I128'
  | 'Option'
  | 'String'
  | 'U64';

export interface SorobanNamedArg {
  name: string;
  kind: SorobanArgKind;
}

export interface SorobanContractFunction {
  /** Soroban export name (snake_case). */
  name: string;
  /** Ordered argument kinds as declared in the ABI. */
  args: SorobanArgKind[];
  namedArgs: SorobanNamedArg[];
}

export interface SorobanContractInterface {
  contract: string;
  source: string;
  functions: SorobanContractFunction[];
}

export const SOROBAN_CONTRACT_INTERFACES: SorobanContractInterface[] = [
  {
    contract: "SubscriptionRegistry",
    source: "contracts/contracts/src/subscription_registry.rs",
    functions: [
      {
        name: "create_subscription",
        args: ["Address", "String", "U64", "I128", "U64"],
        namedArgs: [{ name: "user", kind: "Address" }, { name: "service_id", kind: "String" }, { name: "billing_interval", kind: "U64" }, { name: "expected_amount", kind: "I128" }, { name: "next_renewal", kind: "U64" }],
      },
      {
        name: "update_subscription",
        args: ["BytesN32", "Address", "Option", "Option", "Option", "Option"],
        namedArgs: [{ name: "subscription_id", kind: "BytesN32" }, { name: "user", kind: "Address" }, { name: "service_id", kind: "Option" }, { name: "billing_interval", kind: "Option" }, { name: "expected_amount", kind: "Option" }, { name: "next_renewal", kind: "Option" }],
      },
      {
        name: "cancel_subscription",
        args: ["BytesN32", "Address"],
        namedArgs: [{ name: "subscription_id", kind: "BytesN32" }, { name: "caller", kind: "Address" }],
      },
    ],
  },
  {
    contract: "SubscriptionLogging",
    source: "contracts/contracts/subscription_logging/src/lib.rs",
    functions: [
      {
        name: "record_log",
        args: ["U64", "String", "String"],
        namedArgs: [{ name: "sub_id", kind: "U64" }, { name: "event", kind: "String" }, { name: "data", kind: "String" }],
      },
    ],
  },
  {
    contract: "SubscriptionRenewal",
    source: "contracts/contracts/subscription_renewal/src/lib.rs",
    functions: [
      {
        name: "renew",
        args: ["Address", "U64", "U64", "I128", "U64", "U64", "U64", "Bool"],
        namedArgs: [{ name: "owner", kind: "Address" }, { name: "sub_id", kind: "U64" }, { name: "approval_id", kind: "U64" }, { name: "amount", kind: "I128" }, { name: "max_retries", kind: "U64" }, { name: "cooldown_ledgers", kind: "U64" }, { name: "cycle_id", kind: "U64" }, { name: "succeed", kind: "Bool" }],
      },
    ],
  },
];

/** Lookup a function definition by contract name and Soroban method name. */
export function findContractFunction(
  contract: string,
  method: string,
): SorobanContractFunction | undefined {
  const iface = SOROBAN_CONTRACT_INTERFACES.find((c) => c.contract === contract);
  return iface?.functions.find((fn) => fn.name === method);
}

/** Flat set of all declared Soroban method names (for quick membership checks). */
export function allContractMethodNames(): Set<string> {
  const names = new Set<string>();
  for (const iface of SOROBAN_CONTRACT_INTERFACES) {
    for (const fn of iface.functions) names.add(fn.name);
  }
  return names;
}

export interface SubscriptionRegistryContract {
  create_subscription(args: { user: string; service_id: string; billing_interval: bigint; expected_amount: bigint; next_renewal: bigint }): Promise<unknown>;
  update_subscription(args: { subscription_id: Uint8Array; user: string; service_id: unknown | null; billing_interval: unknown | null; expected_amount: unknown | null; next_renewal: unknown | null }): Promise<unknown>;
  cancel_subscription(args: { subscription_id: Uint8Array; caller: string }): Promise<unknown>;
}

export interface SubscriptionLoggingContract {
  record_log(args: { sub_id: bigint; event: string; data: string }): Promise<unknown>;
}

export interface SubscriptionRenewalContract {
  renew(args: { owner: string; sub_id: bigint; approval_id: bigint; amount: bigint; max_retries: bigint; cooldown_ledgers: bigint; cycle_id: bigint; succeed: boolean }): Promise<unknown>;
}

export interface GeneratedContractMap {
  "SubscriptionRegistry": SubscriptionRegistryContract;
  "SubscriptionLogging": SubscriptionLoggingContract;
  "SubscriptionRenewal": SubscriptionRenewalContract;
}

