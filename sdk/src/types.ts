/**
 * Retry configuration for SDK requests
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds for exponential backoff (default: 30000) */
  maxDelayMs?: number;
  /** HTTP status codes to retry on (default: [408, 429, 500, 502, 503, 504]) */
  retryableStatusCodes?: number[];
}

/**
 * Stellar wallet for blockchain operations
 */
export interface StellarWallet {
  publicKey?: string | (() => string);
  signTransaction?: (...args: any[]) => any;
  sign?: (...args: any[]) => any;
  [key: string]: any;
}

/**
 * Stellar keypair for blockchain operations
 */
export interface StellarKeypair {
  publicKey: string | (() => string);
  secret?: () => string;
  sign?: (...args: any[]) => any;
  [key: string]: any;
}

export interface PaidReceiptPayload {
  receiptId: string;
  requestHash: string;
  route: string;
  unit: string;
  quantity: number;
  amount: number;
  rateCardVersion: string;
  exchangeRate: number | null;
  channelId: string;
  stateNonce: number;
  timestamp: string;
  signerPublicKey: string;
}

export interface PaidReceipt extends PaidReceiptPayload {
  signature: string;
}
