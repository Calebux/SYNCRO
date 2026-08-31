/**
 * Common shared types and utilities
 */

/**
 * Paginated API response wrapper
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

/**
 * API error response
 */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

/**
 * Success response wrapper
 */
export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

/**
 * Timestamp fields for entities
 */
export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

/**
 * Soft delete support
 */
export interface SoftDeletable {
  deletedAt?: string | null;
}

/**
 * Currency code (ISO 4217)
 */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | string;

/**
 * Locale code (BCP 47)
 */
export type LocaleCode = 'en-US' | 'en-GB' | 'es-ES' | 'fr-FR' | 'de-DE' | string;

/**
 * Generates Laplace noise for differential privacy.
 * @param sensitivity The sensitivity of the query/metric
 * @param epsilon The privacy budget parameter (lower means more privacy, more noise)
 */
export function generateLaplaceNoise(sensitivity: number, epsilon: number): number {
  // Uniform random variable in (-0.5, 0.5]
  const u = Math.random() - 0.5;
  const b = sensitivity / epsilon;
  // If u is exactly 0, avoid Math.log(0) by using a tiny offset
  const absU = Math.abs(u) === 0 ? 1e-15 : Math.abs(u);
  return -b * Math.sign(u) * Math.log(1 - 2 * absU);
}

/**
 * Adds differential privacy noise to a numeric metric.
 * Uses Laplace mechanism.
 */
export function addDifferentialPrivacyNoise(
  value: number,
  sensitivity: number = 1.0,
  epsilon: number = 1.0
): number {
  const noise = generateLaplaceNoise(sensitivity, epsilon);
  return value + noise;
}

