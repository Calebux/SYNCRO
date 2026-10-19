/**
 * Closed grammar for provider `quantityExtractor` values.
 *
 * Supported forms (nothing else is accepted):
 *   - `constant:N`      -> literal numeric quantity N (finite number)
 *   - `json:<path>`     -> dotted path into the JSON response body
 *   - `header:<name>`   -> HTTP response header (case-insensitive)
 *   - `bytes:response`  -> raw response byte length
 *
 * Extractors are parsed into a typed AST at registration time and are never
 * evaluated as code. There is no expression parsing, no eval, no Function.
 */

export type QuantityExtractor =
  | { kind: 'constant'; value: number }
  | { kind: 'json'; path: string[] }
  | { kind: 'header'; name: string }
  | { kind: 'bytes' };

export class QuantityExtractorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantityExtractorError';
  }
}

const JSON_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const NUMERIC = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parse a `quantityExtractor` string into a typed AST.
 * Throws `QuantityExtractorError` with a clear message for anything outside
 * the closed grammar.
 */
export function parseQuantityExtractor(input: string): QuantityExtractor {
  if (typeof input !== 'string' || input.length === 0) {
    throw new QuantityExtractorError(
      'quantityExtractor must be a non-empty string',
    );
  }

  const colon = input.indexOf(':');
  if (colon === -1) {
    throw new QuantityExtractorError(
      `Unsupported quantityExtractor "${input}": expected one of ` +
        'constant:N, json:<path>, header:<name>, bytes:response',
    );
  }

  const form = input.slice(0, colon);
  const arg = input.slice(colon + 1);

  switch (form) {
    case 'constant': {
      if (!NUMERIC.test(arg)) {
        throw new QuantityExtractorError(
          `Invalid quantityExtractor "${input}": constant requires a numeric value`,
        );
      }
      const value = Number(arg);
      if (!Number.isFinite(value)) {
        throw new QuantityExtractorError(
          `Invalid quantityExtractor "${input}": constant must be a finite number`,
        );
      }
      return { kind: 'constant', value };
    }

    case 'json': {
      if (arg.length === 0) {
        throw new QuantityExtractorError(
          `Invalid quantityExtractor "${input}": json requires a path`,
        );
      }
      const segments = arg.split('.');
      for (const segment of segments) {
        if (!JSON_PATH_SEGMENT.test(segment)) {
          throw new QuantityExtractorError(
            `Invalid quantityExtractor "${input}": invalid json path segment "${segment}"`,
          );
        }
      }
      return { kind: 'json', path: segments };
    }

    case 'header': {
      if (arg.length === 0 || !HEADER_NAME.test(arg)) {
        throw new QuantityExtractorError(
          `Invalid quantityExtractor "${input}": header requires a valid header name`,
        );
      }
      return { kind: 'header', name: arg.toLowerCase() };
    }

    case 'bytes': {
      if (arg !== 'response') {
        throw new QuantityExtractorError(
          `Invalid quantityExtractor "${input}": bytes only supports "bytes:response"`,
        );
      }
      return { kind: 'bytes' };
    }

    default:
      throw new QuantityExtractorError(
        `Unsupported quantityExtractor "${input}": unknown form "${form}". ` +
          'Expected one of constant:N, json:<path>, header:<name>, bytes:response',
      );
  }
}

/**
 * Apply a parsed extractor to a response. Returns `undefined` when the
 * referenced field is missing or non-numeric. Never evaluates code.
 */
export function applyQuantityExtractor(
  extractor: QuantityExtractor,
  response: {
    body?: unknown;
    headers?: Record<string, string | undefined>;
    bytes?: number;
  },
): number | undefined {
  switch (extractor.kind) {
    case 'constant':
      return extractor.value;

    case 'json': {
      let current: unknown = response.body;
      for (const segment of extractor.path) {
        if (current === null || typeof current !== 'object') {
          return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
      }
      return toFiniteNumber(current);
    }

    case 'header': {
      const headers = response.headers;
      if (!headers) return undefined;
      const raw = headers[extractor.name];
      return toFiniteNumber(raw);
    }

    case 'bytes':
      return typeof response.bytes === 'number' && Number.isFinite(response.bytes)
        ? response.bytes
        : undefined;
  }
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && NUMERIC.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
