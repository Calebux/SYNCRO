/**
 * Hand-written shared API / utility domain types (not generated).
 */

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface SoftDeletable {
  deletedAt?: string | null;
}

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | string;

export type LocaleCode = 'en-US' | 'en-GB' | 'es-ES' | 'fr-FR' | 'de-DE' | string;

export function generateLaplaceNoise(sensitivity: number, epsilon: number): number {
  const u = Math.random() - 0.5;
  const b = sensitivity / epsilon;
  const absU = Math.abs(u) === 0 ? 1e-15 : Math.abs(u);
  return -b * Math.sign(u) * Math.log(1 - 2 * absU);
}

export function addDifferentialPrivacyNoise(
  value: number,
  sensitivity: number = 1.0,
  epsilon: number = 1.0
): number {
  const noise = generateLaplaceNoise(sensitivity, epsilon);
  return value + noise;
}
