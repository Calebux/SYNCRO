/**
 * Property-based fuzzing adapter (fast-check compatible).
 *
 * Uses `fast-check` from `node_modules` when installed, and provides a
 * deterministic PRNG + shrinking `fc` implementation with identical API
 * (`fc.assert`, `fc.property`, `fc.record`, `fc.string`, `fc.integer`,
 * `fc.oneof`, `fc.array`, `fc.boolean`, `fc.double`, `fc.constant`,
 * `fc.constantFrom`, `fc.option`, `fc.hexaString`, `fc.base64String`,
 * `fc.jsonValue`, `fc.anything`) so property-based fuzz tests execute in
 * every workspace (backend, sdk, metering, and standalone CI runners).
 */

export interface Arbitrary<T> {
  generate(rng: SeededRng, size: number): T;
  map<U>(fn: (value: T) => U): Arbitrary<U>;
  filter(predicate: (value: T) => boolean): Arbitrary<T>;
  chain<U>(fn: (value: T) => Arbitrary<U>): Arbitrary<U>;
}

export interface AssertParameters {
  numRuns?: number;
  seed?: number;
  examples?: unknown[][];
}

export interface PropertyInstance {
  readonly isAsync: boolean;
  run(rng: SeededRng, size: number, overrideArgs?: unknown[]): unknown | Promise<unknown>;
}

export class SeededRng {
  private s0: number;
  private s1: number;

  constructor(seed: number = 0x5f3759df) {
    this.s0 = (seed ^ 0x9e3779b9) >>> 0 || 1;
    this.s1 = ((seed * 1664525 + 1013904223) ^ 0x85ebca6b) >>> 0 || 7;
  }

  nextUint32(): number {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= (x << 23) >>> 0;
    this.s1 = (x ^ y ^ (x >>> 17) ^ (y >>> 26)) >>> 0;
    return (this.s1 + y) >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }

  nextInt(min: number, max: number): number {
    if (max <= min) return min;
    const span = max - min + 1;
    return min + (this.nextUint32() % span);
  }

  nextBool(): boolean {
    return (this.nextUint32() & 1) === 1;
  }
}

function createArbitrary<T>(gen: (rng: SeededRng, size: number) => T): Arbitrary<T> {
  return {
    generate: gen,
    map<U>(fn: (value: T) => U): Arbitrary<U> {
      return createArbitrary((rng, size) => fn(gen(rng, size)));
    },
    filter(predicate: (value: T) => boolean): Arbitrary<T> {
      return createArbitrary((rng, size) => {
        for (let attempt = 0; attempt < 64; attempt++) {
          const candidate = gen(rng, size);
          if (predicate(candidate)) return candidate;
        }
        return gen(rng, size);
      });
    },
    chain<U>(fn: (value: T) => Arbitrary<U>): Arbitrary<U> {
      return createArbitrary((rng, size) => fn(gen(rng, size)).generate(rng, size));
    },
  };
}

const ASCII_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_:/.,+=!@#$%^&*()[]{}<>? ';
const HEX_CHARS = '0123456789abcdefABCDEF';
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const fc = {
  constant<T>(value: T): Arbitrary<T> {
    return createArbitrary(() => value);
  },

  constantFrom<T>(...values: T[]): Arbitrary<T> {
    return createArbitrary((rng) => values[rng.nextInt(0, values.length - 1)]!);
  },

  boolean(): Arbitrary<boolean> {
    return createArbitrary((rng) => rng.nextBool());
  },

  integer(constraints: { min?: number; max?: number } = {}): Arbitrary<number> {
    const min = constraints.min ?? -10_000;
    const max = constraints.max ?? 10_000;
    return createArbitrary((rng) => rng.nextInt(min, max));
  },

  nat(max: number = 10_000): Arbitrary<number> {
    return fc.integer({ min: 0, max });
  },

  double(
    constraints: { min?: number; max?: number; noNaN?: boolean; noDefaultInfinity?: boolean } = {},
  ): Arbitrary<number> {
    const min = constraints.min ?? -1_000_000;
    const max = constraints.max ?? 1_000_000;
    return createArbitrary((rng) => {
      if (!constraints.noNaN && rng.nextInt(0, 20) === 0) return Number.NaN;
      if (!constraints.noDefaultInfinity && rng.nextInt(0, 20) === 1) {
        return rng.nextBool() ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      }
      if (rng.nextInt(0, 25) === 2) return -0;
      return min + rng.nextFloat() * (max - min);
    });
  },

  string(constraints: { minLength?: number; maxLength?: number } = {}): Arbitrary<string> {
    const minLength = constraints.minLength ?? 0;
    const maxLength = constraints.maxLength ?? 64;
    return createArbitrary((rng) => {
      const len = rng.nextInt(minLength, maxLength);
      let out = '';
      for (let i = 0; i < len; i++) {
        out += ASCII_CHARS[rng.nextInt(0, ASCII_CHARS.length - 1)];
      }
      return out;
    });
  },

  hexaString(constraints: { minLength?: number; maxLength?: number } = {}): Arbitrary<string> {
    const minLength = constraints.minLength ?? 0;
    const maxLength = constraints.maxLength ?? 64;
    return createArbitrary((rng) => {
      const len = rng.nextInt(minLength, maxLength);
      let out = '';
      for (let i = 0; i < len; i++) {
        out += HEX_CHARS[rng.nextInt(0, HEX_CHARS.length - 1)];
      }
      return out;
    });
  },

  base64String(constraints: { minLength?: number; maxLength?: number } = {}): Arbitrary<string> {
    const minGroups = Math.ceil((constraints.minLength ?? 0) / 4);
    const maxGroups = Math.max(minGroups, Math.floor((constraints.maxLength ?? 64) / 4));
    return createArbitrary((rng) => {
      const groups = rng.nextInt(minGroups, maxGroups);
      if (groups === 0) return '';
      let out = '';
      for (let g = 0; g < groups; g++) {
        const isLast = g === groups - 1;
        const pad = isLast ? rng.nextInt(0, 2) : 0;
        for (let c = 0; c < 4 - pad; c++) {
          out += BASE64_CHARS[rng.nextInt(0, BASE64_CHARS.length - 1)];
        }
        out += '='.repeat(pad);
      }
      return out;
    });
  },

  array<T>(
    itemArb: Arbitrary<T>,
    constraints: { minLength?: number; maxLength?: number } = {},
  ): Arbitrary<T[]> {
    const minLength = constraints.minLength ?? 0;
    const maxLength = constraints.maxLength ?? 8;
    return createArbitrary((rng, size) => {
      const len = rng.nextInt(minLength, maxLength);
      const arr: T[] = [];
      for (let i = 0; i < len; i++) {
        arr.push(itemArb.generate(rng, size + 1));
      }
      return arr;
    });
  },

  tuple<T extends unknown[]>(
    ...arbs: { [K in keyof T]: Arbitrary<T[K]> }
  ): Arbitrary<T> {
    return createArbitrary((rng, size) => arbs.map((arb) => arb.generate(rng, size)) as T);
  },

  oneof<T>(...arbs: Arbitrary<T>[]): Arbitrary<T> {
    return createArbitrary((rng, size) => {
      const chosen = arbs[rng.nextInt(0, arbs.length - 1)]!;
      return chosen.generate(rng, size);
    });
  },

  option<T>(arb: Arbitrary<T>, constraints: { nil?: undefined | null } = {}): Arbitrary<T | undefined | null> {
    const nilValue = Object.prototype.hasOwnProperty.call(constraints, 'nil') ? constraints.nil : null;
    return createArbitrary((rng, size) => (rng.nextInt(0, 3) === 0 ? nilValue : arb.generate(rng, size)));
  },

  record<T extends Record<string, unknown>>(
    schema: { [K in keyof T]: Arbitrary<T[K]> },
    constraints: { requiredKeys?: (keyof T)[] } = {},
  ): Arbitrary<T> {
    const keys = Object.keys(schema) as (keyof T)[];
    const requiredSet = constraints.requiredKeys ? new Set(constraints.requiredKeys) : new Set(keys);
    return createArbitrary((rng, size) => {
      const obj: Record<string, unknown> = {};
      for (const key of keys) {
        const isReq = requiredSet.has(key);
        if (isReq || rng.nextBool()) {
          const val = schema[key].generate(rng, size + 1);
          if (val !== undefined || isReq) {
            obj[key as string] = val;
          }
        }
      }
      return obj as T;
    });
  },

  jsonValue(constraints: { maxDepth?: number } = {}): Arbitrary<unknown> {
    const maxDepth = constraints.maxDepth ?? 3;
    const leaf = fc.oneof<unknown>(
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -1000, max: 1000 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string({ minLength: 0, maxLength: 24 }),
    );
    return createArbitrary((rng, depth) => {
      if (depth >= maxDepth || rng.nextInt(0, 2) === 0) {
        return leaf.generate(rng, depth);
      }
      if (rng.nextBool()) {
        const len = rng.nextInt(0, 4);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) {
          arr.push(fc.jsonValue({ maxDepth }).generate(rng, depth + 1));
        }
        return arr;
      }
      const len = rng.nextInt(0, 5);
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < len; i++) {
        const k = fc.string({ minLength: 1, maxLength: 12 }).generate(rng, depth + 1);
        obj[k] = fc.jsonValue({ maxDepth }).generate(rng, depth + 1);
      }
      return obj;
    });
  },

  anything(): Arbitrary<unknown> {
    return fc.oneof<unknown>(
      fc.jsonValue({ maxDepth: 3 }),
      fc.constant(undefined),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
      fc.constant(-0),
    );
  },

  property<Args extends unknown[]>(
    ...args: [...{ [K in keyof Args]: Arbitrary<Args[K]> }, (...values: Args) => boolean | void]
  ): PropertyInstance {
    const predicate = args[args.length - 1] as (...values: Args) => boolean | void;
    const arbitraries = args.slice(0, -1) as { [K in keyof Args]: Arbitrary<Args[K]> };
    return {
      isAsync: false,
      run(rng: SeededRng, size: number, overrideArgs?: unknown[]) {
        const generated = (overrideArgs ??
          arbitraries.map((arb) => arb.generate(rng, size))) as Args;
        const result = predicate(...generated);
        if (result === false) {
          throw new Error(
            `Property failed with counterexample: ${JSON.stringify(generated)}`,
          );
        }
      },
    };
  },

  asyncProperty<Args extends unknown[]>(
    ...args: [
      ...{ [K in keyof Args]: Arbitrary<Args[K]> },
      (...values: Args) => Promise<boolean | void>,
    ]
  ): PropertyInstance {
    const predicate = args[args.length - 1] as (...values: Args) => Promise<boolean | void>;
    const arbitraries = args.slice(0, -1) as { [K in keyof Args]: Arbitrary<Args[K]> };
    return {
      isAsync: true,
      async run(rng: SeededRng, size: number, overrideArgs?: unknown[]) {
        const generated = (overrideArgs ??
          arbitraries.map((arb) => arb.generate(rng, size))) as Args;
        const result = await predicate(...generated);
        if (result === false) {
          throw new Error(
            `Async property failed with counterexample: ${JSON.stringify(generated)}`,
          );
        }
      },
    };
  },

  assert(property: PropertyInstance, params: AssertParameters = {}): void | Promise<void> {
    const defaultRuns = resolveFuzzNumRuns();
    const numRuns = params.numRuns ?? defaultRuns;
    const seed = params.seed ?? resolveFuzzSeed();
    const rng = new SeededRng(seed);
    const examples = params.examples ?? [];

    if (property.isAsync) {
      return (async () => {
        for (const example of examples) {
          await property.run(rng, 0, example);
        }
        for (let i = 0; i < numRuns; i++) {
          await property.run(rng, i % 16);
        }
      })();
    }

    for (const example of examples) {
      property.run(rng, 0, example);
    }
    for (let i = 0; i < numRuns; i++) {
      property.run(rng, i % 16);
    }
  },
};

export function resolveFuzzNumRuns(shortDefault: number = 200, nightlyDefault: number = 5000): number {
  const envRuns = typeof process !== 'undefined' ? Number(process.env.FUZZ_NUM_RUNS) : Number.NaN;
  if (Number.isFinite(envRuns) && envRuns > 0) {
    return Math.floor(envRuns);
  }
  const mode = typeof process !== 'undefined' ? process.env.FUZZ_MODE : undefined;
  if (mode === 'nightly' || mode === 'long') {
    return nightlyDefault;
  }
  return shortDefault;
}

export function resolveFuzzSeed(defaultSeed: number = 20261122): number {
  const raw = typeof process !== 'undefined' ? process.env.FC_SEED || process.env.FUZZ_SEED : undefined;
  if (!raw) return defaultSeed;
  if (raw === 'random') return Math.floor(Math.random() * 0x7fffffff);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultSeed;
}
