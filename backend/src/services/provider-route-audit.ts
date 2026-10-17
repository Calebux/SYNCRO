/**
 * Audit events for provider route and price changes (issue #1700).
 *
 * Price changes affect what agents pay, so every route create, update, and
 * delete records an entry in the hash-chained audit log carrying the old and
 * new price plus the old and new quantity extractor. When a billing dispute
 * arises, the operator can walk the chain to see who changed a route's price,
 * when, and which rate-card version each call was billed under.
 */

import { auditService } from './audit-service';
import { getRequestId } from '../middleware/requestContext';
import type { RegisteredRoute } from '../v3/types';

export type ProviderRouteAuditAction =
  | 'provider.route_created'
  | 'provider.route_updated'
  | 'provider.route_deleted';

export interface ProviderRouteAuditMeta {
  actorId?: string;
  /** Route state before the change (absent for create). */
  oldRoute?: RegisteredRoute | null;
  /** Route state after the change (absent for delete). */
  newRoute?: RegisteredRoute | null;
  /** Rate-card version that takes effect for future calls (update only). */
  rateCardVersion?: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ProviderRouteAuditMetadata {
  providerId: string;
  method?: string;
  pathPattern?: string;
  unit?: string;
  scopeKey?: string;
  oldPrice: number | null;
  newPrice: number | null;
  oldQuantityExtractor: string | null;
  newQuantityExtractor: string | null;
  rateCardVersion?: string;
  correlationId: string;
  reason?: string;
}

/**
 * Build the chain-covered metadata for a route change. Pure, so the content
 * asserted in tests is exactly what gets hashed into the audit chain.
 */
export function buildProviderRouteAuditMetadata(
  meta: Pick<ProviderRouteAuditMeta, 'oldRoute' | 'newRoute' | 'rateCardVersion' | 'reason'>,
): ProviderRouteAuditMetadata {
  const { oldRoute, newRoute } = meta;
  const route = newRoute ?? oldRoute;
  return {
    providerId: route?.providerId ?? '',
    method: route?.method,
    pathPattern: route?.pathPattern,
    unit: route?.unit,
    scopeKey: route?.scopeKey,
    oldPrice: oldRoute ? oldRoute.price : null,
    newPrice: newRoute ? newRoute.price : null,
    oldQuantityExtractor: oldRoute ? oldRoute.quantityExtractor : null,
    newQuantityExtractor: newRoute ? newRoute.quantityExtractor : null,
    rateCardVersion: meta.rateCardVersion,
    correlationId: getRequestId(),
    reason: meta.reason,
  };
}

/**
 * Write a provider route audit event to the hash-chained `audit_logs` table
 * (see `audit-chain.ts`). The entry's hash covers the metadata built above,
 * so any later edit of the recorded prices breaks chain verification.
 */
export async function auditProviderRouteEvent(
  action: ProviderRouteAuditAction,
  meta: ProviderRouteAuditMeta,
): Promise<void> {
  const route = meta.newRoute ?? meta.oldRoute;
  await auditService.insertEntry({
    userId: meta.actorId,
    action,
    resourceType: 'provider_route',
    resourceId: route?.routeId,
    metadata: buildProviderRouteAuditMetadata(meta),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}
