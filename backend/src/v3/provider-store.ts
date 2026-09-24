import { randomUUID } from 'node:crypto';
import { RegisteredRoute, ProviderMode, ProviderRegistration } from './types';

export interface RegisterProviderInput {
  identity: string;
  payoutAddress: string;
  upstreamBaseUrl: string;
  agreementTerms: string;
  mode: ProviderMode;
}

export interface RegisterRouteInput {
  providerId: string;
  pathPattern: string;
  method: string;
  unit: string;
  price: number;
  quantityExtractor: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

function buildScopeKey(method: string, pathPattern: string): string {
  return `${normalizeMethod(method)}:${pathPattern}`;
}

export class InMemoryProviderStore {
  private readonly providers = new Map<string, ProviderRegistration>();
  private readonly routes = new Map<string, RegisteredRoute>();

  registerProvider(input: RegisterProviderInput): ProviderRegistration {
    const providerId = randomUUID();
    const createdAt = nowIso();
    const record: ProviderRegistration = {
      providerId,
      identity: input.identity,
      payoutAddress: input.payoutAddress,
      upstreamBaseUrl: input.upstreamBaseUrl,
      agreementTerms: input.agreementTerms,
      mode: input.mode,
      payoutVerified: false,
      payoutChallenge: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.providers.set(providerId, record);
    return record;
  }

  getProvider(providerId: string): ProviderRegistration | null {
    return this.providers.get(providerId) ?? null;
  }

  saveProvider(provider: ProviderRegistration): void {
    provider.updatedAt = nowIso();
    this.providers.set(provider.providerId, provider);
  }

  registerRoute(input: RegisterRouteInput): RegisteredRoute {
    const routeId = randomUUID();
    const route: RegisteredRoute = {
      routeId,
      providerId: input.providerId,
      pathPattern: input.pathPattern,
      method: normalizeMethod(input.method),
      unit: input.unit,
      price: input.price,
      quantityExtractor: input.quantityExtractor,
      scopeKey: buildScopeKey(input.method, input.pathPattern),
      createdAt: nowIso(),
    };
    this.routes.set(routeId, route);
    return route;
  }

  findRoute(providerId: string, method: string, requestPath: string): RegisteredRoute | null {
    const normalized = normalizeMethod(method);
    const routeList = [...this.routes.values()].filter((route) => route.providerId === providerId && route.method === normalized);
    for (const route of routeList) {
      if (pathMatchesPattern(requestPath, route.pathPattern)) {
        return route;
      }
    }
    return null;
  }
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*')}$`,
  );
  return regex.test(path);
}

