import { z } from 'zod';

/**
 * Closed grammar for `quantityExtractor`.
 *
 * Supported forms:
 *   - `constant:N`      -> literal numeric quantity N (finite number)
 *   - `json:<path>`     -> dotted path into the JSON response body (e.g. `json:data.amount`)
 *   - `header:<name>`   -> HTTP response header value (e.g. `header:x-quantity`)
 *   - `bytes:response`  -> raw response byte length
 *
 * Extractors are parsed into a typed AST at registration time and are never
 * evaluated as code.
 */
export type QuantityExtractor =
  | { kind: 'constant'; value: number }
  | { kind: 'json'; path: string[] }
  | { kind: 'header'; name: string }
  | { kind: 'bytes'; source: 'response' };

export class QuantityExtractorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantityExtractorError';
  }
}

const JSON_PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const NUMERIC = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseConstant(raw: string): QuantityExtractor {
  if (!NUMERIC.test(raw)) {
    throw new QuantityExtractorError(
      `quantityExtractor: 'constant:' requires a numeric value, got '${raw}'`,
    );
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new QuantityExtractorError(
      `quantityExtractor: 'constant:' value must be finite, got '${raw}'`,
    );
  }
  return { kind: 'constant', value };
}

function parseJson(raw: string): QuantityExtractor {
  if (raw.length === 0) {
    throw new QuantityExtractorError(
      "quantityExtractor: 'json:' requires a non-empty path",
    );
  }
  const segments = raw.split('.');
  for (const segment of segments) {
    if (!JSON_PATH_SEGMENT.test(segment)) {
      throw new QuantityExtractorError(
        `quantityExtractor: invalid json path segment '${segment}' in 'json:${raw}'`,
      );
    }
  }
  return { kind: 'json', path: segments };
}

function parseHeader(raw: string): QuantityExtractor {
  if (raw.length === 0) {
    throw new QuantityExtractorError(
      "quantityExtractor: 'header:' requires a non-empty header name",
    );
  }
  if (!HEADER_NAME.test(raw)) {
    throw new QuantityExtractorError(
      `quantityExtractor: invalid header name '${raw}'`,
    );
  }
  return { kind: 'header', name: raw.toLowerCase() };
}

function parseBytes(raw: string): QuantityExtractor {
  if (raw !== 'response') {
    throw new QuantityExtractorError(
      `quantityExtractor: 'bytes:' only supports 'response', got '${raw}'`,
    );
  }
  return { kind: 'bytes', source: 'response' };
}

/**
 * Parse a `quantityExtractor` string into a typed AST.
 * Throws `QuantityExtractorError` for anything outside the closed grammar.
 */
export function parseQuantityExtractor(input: string): QuantityExtractor {
  if (typeof input !== 'string' || input.length === 0) {
    throw new QuantityExtractorError(
      'quantityExtractor: value must be a non-empty string',
    );
  }
  const sep = input.indexOf(':');
  if (sep === -1) {
    throw new QuantityExtractorError(
      `quantityExtractor: missing form prefix in '${input}' (expected one of constant:, json:, header:, bytes:)`,
    );
  }
  const form = input.slice(0, sep);
  const rest = input.slice(sep + 1);
  switch (form) {
    case 'constant':
      return parseConstant(rest);
    case 'json':
      return parseJson(rest);
    case 'header':
      return parseHeader(rest);
    case 'bytes':
      return parseBytes(rest);
    default:
      throw new QuantityExtractorError(
        `quantityExtractor: unsupported form '${form}' in '${input}' (expected one of constant:, json:, header:, bytes:)`,
      );
  }
}

/**
 * Zod schema that validates and parses `quantityExtractor` at route
 * registration time. The parsed AST is exposed via `.transform`.
 */
export const quantityExtractorSchema = z
  .string()
  .min(1)
  .default('constant:1')
  .superRefine((value, ctx) => {
    try {
      parseQuantityExtractor(value);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })
  .transform((value) => parseQuantityExtractor(value));

export type QuantityExtractorInput = z.input<typeof quantityExtractorSchema>;
export type QuantityExtractorOutput = z.output<typeof quantityExtractorSchema>;
