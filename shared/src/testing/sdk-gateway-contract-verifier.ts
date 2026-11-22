import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ContractFieldSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  enum?: string[];
  const?: unknown;
  format?: string;
}

export interface ContractTaxonomyEntry {
  code: string;
  className: string;
  httpStatus: number;
  action: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  supportsRetryAfterHeader: boolean;
  defaultMessage: string;
}

export interface SdkGatewayContractSpec {
  contractVersion: string;
  issue: string;
  taxonomyIssue: string;
  headers: {
    paymentRequired: string;
    paymentSignature: string;
    paymentResponse: string;
    inlineReceipt: string;
    receiptUrl: string;
    meterDegraded: string;
    retryAfter: string;
    idempotencyKey: string;
    agentId: string;
    providerPaymentProof: string;
  };
  challengeContracts: {
    gatewayChannelStateChallenge: {
      httpStatus: number;
      headerName: string;
      encoding: string;
      requiredFields: ContractFieldSpec[];
      responseBodyRequiredFields: ContractFieldSpec[];
    };
    x402V2Challenge: {
      httpStatus: number;
      headerName: string;
      encoding: string;
      requiredFields: ContractFieldSpec[];
      optionalFields: ContractFieldSpec[];
      acceptRequirementFields: ContractFieldSpec[];
    };
  };
  paymentProofContracts: {
    gatewayChannelStateProof: {
      headerName: string;
      encoding: string;
      requiredFields: ContractFieldSpec[];
      optionalFields: ContractFieldSpec[];
    };
    x402SignedPayload: {
      headerName: string;
      encoding: string;
      requiredFields: ContractFieldSpec[];
    };
  };
  settlementResponseContracts: {
    x402PaymentResponse: {
      headerName: string;
      encoding: string;
      requiredFields: ContractFieldSpec[];
      optionalFields: ContractFieldSpec[];
    };
    gatewayPaidCallHeaders: {
      inlineReceiptHeader: string;
      receiptUrlHeader: string;
      meterDegradedHeader: string;
    };
  };
  errorBodyContract: {
    requiredFields: ContractFieldSpec[];
    optionalFields: ContractFieldSpec[];
  };
  errorTaxonomy: ContractTaxonomyEntry[];
}

export class SdkGatewayContractMismatchError extends Error {
  readonly interaction: string;
  readonly field: string;

  constructor(interaction: string, field: string, detail: string) {
    super(`[SDK↔Gateway Contract Mismatch] (${interaction} :: ${field}) ${detail}`);
    this.name = 'SdkGatewayContractMismatchError';
    this.interaction = interaction;
    this.field = field;
  }
}

export function loadSdkGatewayContract(repoRoot?: string): SdkGatewayContractSpec {
  const candidates = [
    repoRoot,
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    const contractPath = path.join(candidate, 'shared', 'contracts', 'sdk-gateway-contract.json');
    try {
      return JSON.parse(readFileSync(contractPath, 'utf8')) as SdkGatewayContractSpec;
    } catch {
      // Try next candidate
    }
  }
  throw new Error('Unable to locate shared/contracts/sdk-gateway-contract.json');
}

function checkFieldValue(
  interaction: string,
  container: Record<string, unknown>,
  spec: ContractFieldSpec,
  required: boolean,
): void {
  const hasKey = Object.prototype.hasOwnProperty.call(container, spec.name);
  if (!hasKey || container[spec.name] === undefined) {
    if (required) {
      throw new SdkGatewayContractMismatchError(
        interaction,
        spec.name,
        `Missing required field "${spec.name}" that the SDK depends on.`,
      );
    }
    return;
  }

  const val = container[spec.name];
  if (spec.type === 'array') {
    if (!Array.isArray(val)) {
      throw new SdkGatewayContractMismatchError(
        interaction,
        spec.name,
        `Expected "${spec.name}" to be an array, got ${typeof val}.`,
      );
    }
  } else if (spec.type === 'object') {
    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      throw new SdkGatewayContractMismatchError(
        interaction,
        spec.name,
        `Expected "${spec.name}" to be an object, got ${val === null ? 'null' : typeof val}.`,
      );
    }
  } else if (typeof val !== spec.type) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      spec.name,
      `Expected "${spec.name}" to have type "${spec.type}", got "${typeof val}".`,
    );
  }

  if (spec.const !== undefined && val !== spec.const) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      spec.name,
      `Expected "${spec.name}" to equal ${JSON.stringify(spec.const)}, got ${JSON.stringify(val)}.`,
    );
  }

  if (spec.enum && (typeof val !== 'string' || !spec.enum.includes(val))) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      spec.name,
      `Expected "${spec.name}" to be one of [${spec.enum.join(', ')}], got ${JSON.stringify(val)}.`,
    );
  }

  if (spec.format === 'iso-date-time' && (typeof val !== 'string' || Number.isNaN(Date.parse(val)))) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      spec.name,
      `Expected "${spec.name}" to be a valid ISO-8601 timestamp, got ${JSON.stringify(val)}.`,
    );
  }
}

export function assertGatewayChallengeResponseMatchesContract(
  contract: SdkGatewayContractSpec,
  response: {
    status: number;
    headers: Record<string, string | undefined>;
    body: Record<string, unknown>;
  },
): void {
  const spec = contract.challengeContracts.gatewayChannelStateChallenge;
  const interaction = 'gatewayChannelStateChallenge';

  if (response.status !== spec.httpStatus) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'httpStatus',
      `Expected status ${spec.httpStatus}, got ${response.status}.`,
    );
  }

  const expectedHeader = spec.headerName;
  const headerVal =
    response.headers[expectedHeader] ??
    response.headers[expectedHeader.toLowerCase()];

  if (!headerVal || typeof headerVal !== 'string') {
    throw new SdkGatewayContractMismatchError(
      interaction,
      `header:${expectedHeader}`,
      `Gateway 402 response is missing required "${expectedHeader}" header.`,
    );
  }

  let decodedChallenge: Record<string, unknown>;
  try {
    decodedChallenge = JSON.parse(Buffer.from(headerVal, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new SdkGatewayContractMismatchError(
      interaction,
      `header:${expectedHeader}`,
      `Header "${expectedHeader}" is not valid base64-encoded JSON.`,
    );
  }

  for (const fieldSpec of spec.requiredFields) {
    checkFieldValue(interaction, decodedChallenge, fieldSpec, true);
  }

  for (const bodyFieldSpec of spec.responseBodyRequiredFields) {
    checkFieldValue(`${interaction}:body`, response.body, bodyFieldSpec, true);
  }

  const bodyChallenge = response.body.challenge as Record<string, unknown>;
  for (const fieldSpec of spec.requiredFields) {
    checkFieldValue(`${interaction}:body.challenge`, bodyChallenge, fieldSpec, true);
  }
}

export function assertX402ChallengeHeaderMatchesContract(
  contract: SdkGatewayContractSpec,
  headerName: string,
  headerValue: string,
): void {
  const spec = contract.challengeContracts.x402V2Challenge;
  const interaction = 'x402V2Challenge';

  if (headerName.toUpperCase() !== spec.headerName.toUpperCase()) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'headerName',
      `Expected header name "${spec.headerName}", got "${headerName}".`,
    );
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'encoding',
      `Header "${headerName}" is not valid base64-encoded JSON.`,
    );
  }

  for (const fieldSpec of spec.requiredFields) {
    checkFieldValue(interaction, decoded, fieldSpec, true);
  }
  for (const fieldSpec of spec.optionalFields) {
    checkFieldValue(interaction, decoded, fieldSpec, false);
  }

  const accepts = decoded.accepts as unknown[];
  for (const item of accepts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new SdkGatewayContractMismatchError(
        interaction,
        'accepts[]',
        'Each accepts entry must be a JSON object.',
      );
    }
    for (const reqField of spec.acceptRequirementFields) {
      checkFieldValue(`${interaction}:accepts[]`, item as Record<string, unknown>, reqField, true);
    }
  }
}

export function assertErrorResponseMatchesContract(
  contract: SdkGatewayContractSpec,
  expectedCode: string,
  response: {
    status: number;
    headers: Record<string, string | undefined>;
    body: Record<string, unknown>;
  },
): void {
  const interaction = `errorTaxonomy:${expectedCode}`;
  const taxonomyEntry = contract.errorTaxonomy.find((e) => e.code === expectedCode);
  if (!taxonomyEntry) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'code',
      `Code "${expectedCode}" is not defined in the consumer contract error taxonomy.`,
    );
  }

  if (response.status !== taxonomyEntry.httpStatus) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'httpStatus',
      `Expected HTTP status ${taxonomyEntry.httpStatus} for ${expectedCode}, got ${response.status}.`,
    );
  }

  for (const reqField of contract.errorBodyContract.requiredFields) {
    checkFieldValue(interaction, response.body, reqField, true);
  }
  for (const optField of contract.errorBodyContract.optionalFields) {
    checkFieldValue(interaction, response.body, optField, false);
  }

  if (response.body.code !== taxonomyEntry.code) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'body.code',
      `Expected body.code "${taxonomyEntry.code}", got ${JSON.stringify(response.body.code)}.`,
    );
  }
  if (response.body.action !== taxonomyEntry.action) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'body.action',
      `Expected body.action "${taxonomyEntry.action}", got ${JSON.stringify(response.body.action)}.`,
    );
  }
  if (response.body.retryable !== taxonomyEntry.retryable) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'body.retryable',
      `Expected body.retryable ${taxonomyEntry.retryable}, got ${JSON.stringify(response.body.retryable)}.`,
    );
  }

  if (response.body.retryAfterSeconds !== undefined) {
    const retryHeader =
      response.headers[contract.headers.retryAfter] ??
      response.headers[contract.headers.retryAfter.toLowerCase()];
    if (!retryHeader) {
      throw new SdkGatewayContractMismatchError(
        interaction,
        `header:${contract.headers.retryAfter}`,
        `Expected "${contract.headers.retryAfter}" header when retryAfterSeconds is present.`,
      );
    }
  }
}

export function assertGatewayTaxonomyAlignedWithContract(
  contract: SdkGatewayContractSpec,
  gatewayTaxonomyErrors: ContractTaxonomyEntry[],
): void {
  const interaction = 'gatewayTaxonomy';
  if (gatewayTaxonomyErrors.length !== contract.errorTaxonomy.length) {
    throw new SdkGatewayContractMismatchError(
      interaction,
      'errors.length',
      `Contract expects ${contract.errorTaxonomy.length} taxonomy codes, gateway has ${gatewayTaxonomyErrors.length}.`,
    );
  }

  const gatewayByCode = new Map(gatewayTaxonomyErrors.map((e) => [e.code, e]));
  for (const expected of contract.errorTaxonomy) {
    const actual = gatewayByCode.get(expected.code);
    if (!actual) {
      throw new SdkGatewayContractMismatchError(
        interaction,
        expected.code,
        `Gateway taxonomy removed or renamed code "${expected.code}" which the SDK depends on.`,
      );
    }
    const fields: (keyof ContractTaxonomyEntry)[] = [
      'className',
      'httpStatus',
      'action',
      'retryable',
      'supportsRetryAfterHeader',
      'defaultMessage',
      'retryAfterSeconds',
    ];
    for (const f of fields) {
      if (actual[f] !== expected[f]) {
        throw new SdkGatewayContractMismatchError(
          interaction,
          `${expected.code}.${f}`,
          `Expected ${expected.code}.${f} = ${JSON.stringify(expected[f])}, got ${JSON.stringify(actual[f])}.`,
        );
      }
    }
  }
}
