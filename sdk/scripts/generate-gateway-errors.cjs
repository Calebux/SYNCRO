#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const taxonomyPath = path.resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "src",
  "errors",
  "gateway-taxonomy.json",
);
const outputPath = path.resolve(__dirname, "..", "src", "generated", "gateway-errors.ts");

function pascalToConst(input) {
  return input.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase().replace(/^_/, "");
}

function renderFile(taxonomyRaw) {
  const hash = crypto.createHash("sha256").update(taxonomyRaw).digest("hex");
  const taxonomy = JSON.parse(taxonomyRaw);
  const errors = taxonomy.errors;

  const codeUnion = errors.map((entry) => `'${entry.code}'`).join(" | ");
  const classDecls = errors
    .map((entry) => {
      const supportsRetry = entry.supportsRetryAfterHeader ? "true" : "false";
      const retryable = entry.retryable ? "true" : "false";
      return `export class ${entry.className} extends GatewaySdkError {
  static readonly gatewayCode = '${entry.code}' as const;
  static readonly defaultHttpStatus = ${entry.httpStatus} as const;
  static readonly retryableByDefault = ${retryable} as const;
  static readonly supportsRetryAfterHeader = ${supportsRetry} as const;

  constructor(details: GatewayErrorDetails = {}) {
    super({
      ...details,
      code: ${entry.className}.gatewayCode,
      message: details.message ?? ${JSON.stringify(entry.defaultMessage)},
      status: details.status ?? ${entry.className}.defaultHttpStatus,
      retryable: ${entry.className}.retryableByDefault,
      retryAfterMs:
        details.retryAfterMs ?? (details.retryAfterSeconds !== undefined ? details.retryAfterSeconds * 1000 : undefined),
    });
  }
}
`;
    })
    .join("\n");

  const codeMapLines = errors
    .map((entry) => `  ${entry.code}: ${entry.className},`)
    .join("\n");

  const statusMapLines = errors
    .map((entry) => `  ${entry.httpStatus}: ${entry.className},`)
    .join("\n");

  const retryDefaults = errors
    .map(
      (entry) =>
        `  ${entry.code}: { retryable: ${entry.retryable ? "true" : "false"}, supportsRetryAfter: ${
          entry.supportsRetryAfterHeader ? "true" : "false"
        } },`,
    )
    .join("\n");

  return `/**
 * AUTO-GENERATED FILE — DO NOT EDIT
 * Source: backend/src/errors/gateway-taxonomy.json
 * Taxonomy version: ${taxonomy.version}
 * Taxonomy hash: ${hash}
 */

export type GatewayErrorCode = ${codeUnion};

export interface GatewayErrorDetails {
  message?: string;
  status?: number;
  retryAfterMs?: number;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class GatewaySdkError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(input: {
    code: GatewayErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "GatewaySdkError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }
}

${classDecls}
const ERROR_BY_CODE = {
${codeMapLines}
} as const;

const ERROR_BY_HTTP_STATUS = {
${statusMapLines}
} as const;

const RETRY_DEFAULTS = {
${retryDefaults}
} as const;

export type GeneratedGatewayError =
${errors.map((entry) => `  | ${entry.className}`).join("\n")};

export function createGatewayErrorFromCode(
  code: GatewayErrorCode,
  details: GatewayErrorDetails = {},
): GeneratedGatewayError {
  const Cls = ERROR_BY_CODE[code];
  return new Cls(details);
}

export function createGatewayErrorFromHttpStatus(
  status: number,
  details: GatewayErrorDetails = {},
): GeneratedGatewayError | null {
  const Cls = ERROR_BY_HTTP_STATUS[status as keyof typeof ERROR_BY_HTTP_STATUS];
  return Cls ? new Cls({ ...details, status }) : null;
}

export function getGatewayRetrySemantics(code: GatewayErrorCode): {
  retryable: boolean;
  supportsRetryAfter: boolean;
} {
  return RETRY_DEFAULTS[code];
}
`;
}

function main() {
  const taxonomyRaw = fs.readFileSync(taxonomyPath, "utf8");
  const rendered = renderFile(taxonomyRaw);
  fs.writeFileSync(outputPath, rendered);
  process.stdout.write(`Generated ${path.relative(process.cwd(), outputPath)}\n`);
}

main();
