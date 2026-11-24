/**
 * Common types shared across the domain.
 *
 * Pure data layer: interfaces and type aliases only.
 * No imports from logic/ or platform/.
 */

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY' | 'INR' | 'BRL';
export type LocaleCode = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh' | 'pt' | 'hi';

export interface TimestampedEntity {
  createdAt: string;
  updatedAt: string;
}

export interface SoftDeletableEntity {
  deletedAt?: string | null;
}

export interface VersionedEntity {
  version: number;
}

export interface AuditableEntity extends TimestampedEntity {
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}
