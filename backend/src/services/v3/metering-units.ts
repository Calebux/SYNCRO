import logger from '../../config/logger';

/**
 * Model a unit as a named quantity with an integer representation.
 */
export interface MeterUnit {
  name: string; // e.g. 'tokens', 'bytes', 'calls', 'seconds'
  quantity: number; // integer representation
}

/**
 * Response context passed to per-route quantity extractors.
 */
export interface ResponseExtractionContext {
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  streamChunks?: any[];
  streamEnded?: boolean;
  durationMs?: number;
}

/**
 * Function type for extracting an integer unit quantity from response context.
 */
export type QuantityExtractor = (ctx: ResponseExtractionContext) => number | Promise<number>;

/**
 * Route configuration declaring unit metering rules.
 */
export interface MeteredRouteConfig {
  path: string;
  unitName: string; // 'tokens' | 'bytes' | 'calls' | 'seconds' | custom
  unitPrice: number; // cost per integer unit
  reservationBound: number; // upper bound integer units reserved upfront
  requiredScope: string;
  providerId: string;
  extractor?: QuantityExtractor;
}

/**
 * Built-in Extractors
 */

// Call-billed extractor: always returns 1 call unit
export const callQuantityExtractor: QuantityExtractor = () => 1;

// Token-billed extractor: extracts total_tokens or tokens integer from response body or SSE stream
export const tokenQuantityExtractor: QuantityExtractor = (ctx) => {
  if (ctx.body) {
    let bodyObj = ctx.body;
    if (typeof bodyObj === 'string') {
      try {
        bodyObj = JSON.parse(bodyObj);
      } catch {
        // Not JSON string
      }
    }
    if (typeof bodyObj === 'object' && bodyObj !== null) {
      if (typeof bodyObj.usage?.total_tokens === 'number') {
        return Math.round(bodyObj.usage.total_tokens);
      }
      if (typeof bodyObj.tokens === 'number') {
        return Math.round(bodyObj.tokens);
      }
      if (typeof bodyObj.usage?.totalTokens === 'number') {
        return Math.round(bodyObj.usage.totalTokens);
      }
    }
  }

  if (ctx.streamChunks && ctx.streamChunks.length > 0) {
    for (let i = ctx.streamChunks.length - 1; i >= 0; i--) {
      const chunk = ctx.streamChunks[i];
      const chunkStr = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const lines = chunkStr.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const dataStr = line.slice(5).trim();
          if (dataStr && dataStr !== '[DONE]') {
            try {
              const parsed = JSON.parse(dataStr);
              if (typeof parsed.usage?.total_tokens === 'number') {
                return Math.round(parsed.usage.total_tokens);
              }
              if (typeof parsed.tokens === 'number') {
                return Math.round(parsed.tokens);
              }
            } catch {
              // Ignore chunk parse errors
            }
          }
        }
      }
    }
  }

  throw new Error('Could not extract token count from response body or stream chunks');
};

// Byte-billed extractor: extracts content-length or sums chunk byte lengths
export const byteQuantityExtractor: QuantityExtractor = (ctx) => {
  const contentLength = ctx.headers['content-length'] || ctx.headers['Content-Length'];
  if (contentLength) {
    const bytes = parseInt(Array.isArray(contentLength) ? contentLength[0] : contentLength, 10);
    if (!isNaN(bytes) && bytes >= 0) return Math.round(bytes);
  }

  if (ctx.streamChunks && ctx.streamChunks.length > 0) {
    const totalBytes = ctx.streamChunks.reduce((acc, chunk) => {
      if (typeof chunk === 'string') return acc + Buffer.byteLength(chunk);
      if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) return acc + chunk.length;
      return acc;
    }, 0);
    if (totalBytes > 0) return Math.round(totalBytes);
  }

  throw new Error('Could not extract byte count from Content-Length or stream chunks');
};

// Seconds-billed extractor: extracts compute duration in seconds
export const secondsQuantityExtractor: QuantityExtractor = (ctx) => {
  const headerVal = ctx.headers['x-compute-seconds'] || ctx.headers['X-Compute-Seconds'];
  if (headerVal) {
    const sec = parseFloat(Array.isArray(headerVal) ? headerVal[0] : headerVal);
    if (!isNaN(sec) && sec >= 0) return Math.max(1, Math.round(sec));
  }

  if (ctx.durationMs !== undefined && ctx.durationMs > 0) {
    return Math.max(1, Math.round(ctx.durationMs / 1000));
  }

  throw new Error('Could not extract compute seconds from X-Compute-Seconds header or duration');
};

export function getDefaultExtractor(unitName: string): QuantityExtractor {
  switch (unitName.toLowerCase()) {
    case 'tokens':
      return tokenQuantityExtractor;
    case 'bytes':
      return byteQuantityExtractor;
    case 'seconds':
      return secondsQuantityExtractor;
    case 'calls':
    default:
      return callQuantityExtractor;
  }
}

/**
 * Route Registry for metered routes.
 */
export class MeteredRouteRegistry {
  private routes = new Map<string, MeteredRouteConfig>();

  constructor() {
    this.registerDefaults();
  }

  registerRoute(config: MeteredRouteConfig): void {
    this.routes.set(config.path, config);
  }

  getRouteConfig(path: string): MeteredRouteConfig {
    if (this.routes.has(path)) {
      return this.routes.get(path)!;
    }

    // Dynamic prefix match if exact match not found
    for (const [registeredPath, config] of this.routes.entries()) {
      if (path.startsWith(registeredPath)) {
        return config;
      }
    }

    // Default call-billed fallback route configuration
    return {
      path,
      unitName: 'calls',
      unitPrice: 8,
      reservationBound: 1,
      requiredScope: 'llm:call',
      providerId: 'provider_testnet_1',
      extractor: callQuantityExtractor,
    };
  }

  registerDefaults(): void {
    this.routes.set('/api/v3/gateway/inference', {
      path: '/api/v3/gateway/inference',
      unitName: 'tokens',
      unitPrice: 0.1,
      reservationBound: 100,
      requiredScope: 'llm:call',
      providerId: 'provider_testnet_1',
      extractor: tokenQuantityExtractor,
    });

    this.routes.set('/api/v3/gateway/storage', {
      path: '/api/v3/gateway/storage',
      unitName: 'bytes',
      unitPrice: 0.01,
      reservationBound: 1000,
      requiredScope: 'storage:write',
      providerId: 'provider_testnet_1',
      extractor: byteQuantityExtractor,
    });

    this.routes.set('/api/v3/gateway/compute', {
      path: '/api/v3/gateway/compute',
      unitName: 'seconds',
      unitPrice: 0.5,
      reservationBound: 20,
      requiredScope: 'compute:run',
      providerId: 'provider_testnet_1',
      extractor: secondsQuantityExtractor,
    });

    this.routes.set('/api/v3/gateway/proxy', {
      path: '/api/v3/gateway/proxy',
      unitName: 'calls',
      unitPrice: 8,
      reservationBound: 1,
      requiredScope: 'llm:call',
      providerId: 'provider_testnet_1',
      extractor: callQuantityExtractor,
    });
  }

  clear(): void {
    this.routes.clear();
    this.registerDefaults();
  }
}

export const meteredRouteRegistry = new MeteredRouteRegistry();

export interface QuantityExtractionResult {
  quantity: number;
  actualPrice: number;
  extractedSuccessfully: boolean;
  reason?: string;
}

/**
 * Extracts unit quantity and calculates actual cost for a route.
 * If extraction fails or stream was dropped mid-stream, falls back to reservation bound and logs it.
 */
export async function extractQuantityAndCalculatePrice(
  config: MeteredRouteConfig,
  ctx: ResponseExtractionContext,
  streamDropped: boolean = false
): Promise<QuantityExtractionResult> {
  if (streamDropped || ctx.streamEnded === false) {
    const reason = 'Connection dropped mid-stream before stream completed';
    logger.warn(
      `[MeteringExtractor] Extraction fallback triggered for route ${config.path} (unit: ${config.unitName}): ${reason}. Charging reservation bound of ${config.reservationBound} units.`
    );
    return {
      quantity: config.reservationBound,
      actualPrice: Math.round(config.reservationBound * config.unitPrice * 100) / 100,
      extractedSuccessfully: false,
      reason,
    };
  }

  const extractor = config.extractor || getDefaultExtractor(config.unitName);

  try {
    const rawQuantity = await extractor(ctx);
    if (typeof rawQuantity !== 'number' || isNaN(rawQuantity) || rawQuantity < 0) {
      throw new Error(`Extractor returned invalid quantity: ${rawQuantity}`);
    }
    const quantity = Math.round(rawQuantity);
    const actualPrice = Math.round(quantity * config.unitPrice * 100) / 100;
    return {
      quantity,
      actualPrice,
      extractedSuccessfully: true,
    };
  } catch (err: any) {
    const reason = `Extractor error: ${err.message}`;
    logger.warn(
      `[MeteringExtractor] Extraction failed for route ${config.path} (unit: ${config.unitName}): ${reason}. Charging reservation bound of ${config.reservationBound} units.`
    );
    return {
      quantity: config.reservationBound,
      actualPrice: Math.round(config.reservationBound * config.unitPrice * 100) / 100,
      extractedSuccessfully: false,
      reason,
    };
  }
}
