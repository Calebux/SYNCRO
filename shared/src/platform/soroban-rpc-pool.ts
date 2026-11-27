export interface SorobanRpcEndpointHealth {
  url: string;
  healthy: boolean;
  score: number;
  consecutiveFailures: number;
  latestLedger?: number | undefined;
  lastError?: string | undefined;
  ledgerLagged?: boolean | undefined;
}

export interface SorobanRpcPoolOptions {
  endpoints: string[];
  /** Maximum ledger distance tolerated when comparing providers. */
  maxLedgerLag?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  onSingleHealthyEndpoint?: (health: SorobanRpcEndpointHealth[]) => void;
}

interface JsonRpcResponse {
  error?: { message?: string };
  result?: unknown;
}

const DEFAULT_MAX_LEDGER_LAG = 2;
const DEFAULT_TIMEOUT_MS = 10_000;

export function resolveSorobanRpcEndpoints(
  primaryUrl?: string,
  urls?: string,
): string[] {
  const configured = urls?.split(',').map((url) => url.trim()).filter(Boolean) ?? [];
  if (configured.length > 0) return [...new Set(configured)];
  return primaryUrl ? [primaryUrl] : [];
}

/** JSON-RPC client with scored endpoint failover and ledger consistency checks. */
export class SorobanRpcPool {
  private readonly endpoints: SorobanRpcEndpointHealth[];
  private readonly maxLedgerLag: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly onSingleHealthyEndpoint?: SorobanRpcPoolOptions['onSingleHealthyEndpoint'];
  private alertedSingleHealthy = false;

  constructor(options: SorobanRpcPoolOptions) {
    const endpoints = [...new Set(options.endpoints.map((url) => url.trim()).filter(Boolean))];
    if (endpoints.length === 0) {
      throw new Error('Soroban RPC pool requires at least one endpoint');
    }

    for (const endpoint of endpoints) {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Soroban RPC endpoint must use HTTP or HTTPS: ${parsed.origin}`);
      }
    }

    this.endpoints = endpoints.map((url) => ({
      url,
      healthy: false,
      score: 0,
      consecutiveFailures: 0,
    }));
    this.maxLedgerLag = options.maxLedgerLag ?? DEFAULT_MAX_LEDGER_LAG;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.onSingleHealthyEndpoint = options.onSingleHealthyEndpoint;
  }

  getHealth(): SorobanRpcEndpointHealth[] {
    return this.endpoints.map((endpoint) => ({
      ...endpoint,
      url: new URL(endpoint.url).origin,
      lastError: endpoint.lastError?.replace(
        /https?:\/\/[^\s)]+/g,
        (value) => {
          try {
            return new URL(value).origin;
          } catch {
            return '[provider URL]';
          }
        },
      ),
    }));
  }

  async fetch(init: RequestInit): Promise<Response> {
    const candidates = [...this.endpoints]
      .filter((endpoint) => endpoint.healthy)
      .sort((a, b) => b.score - a.score);
    const ordered = candidates.length > 0
      ? [...candidates, ...this.endpoints.filter((endpoint) => !endpoint.healthy)
          .sort((a, b) => b.score - a.score)]
      : [...this.endpoints].sort((a, b) => b.score - a.score);
    const errors: string[] = [];

    for (const endpoint of ordered) {
      try {
        const response = await this.requestEndpoint(endpoint.url, init);
        if (!endpoint.ledgerLagged) endpoint.healthy = true;
        endpoint.consecutiveFailures = 0;
        if (!endpoint.ledgerLagged) endpoint.lastError = undefined;
        endpoint.score = Math.min(100, endpoint.score + 1);
        this.updateSingleHealthyAlert();
        return response;
      } catch (error) {
        if (init.signal?.aborted) throw error;
        endpoint.healthy = false;
        endpoint.consecutiveFailures++;
        endpoint.lastError = this.getSafeError(error);
        endpoint.score = Math.max(-100, endpoint.score - 10);
        errors.push(`provider ${this.endpoints.indexOf(endpoint) + 1}: ${endpoint.lastError}`);
        this.updateSingleHealthyAlert();
      }
    }

    throw new Error(`All Soroban RPC endpoints failed: ${errors.join('; ')}`);
  }

  /** Probe each configured provider and mark endpoints too far behind as unhealthy. */
  async checkLedgerAgreement(signal?: AbortSignal): Promise<SorobanRpcEndpointHealth[]> {
    const ledgers = await Promise.all(this.endpoints.map(async (endpoint) => {
      try {
        const response = await this.requestEndpoint(endpoint.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
          ...(signal ? { signal } : {}),
        });
        const data = await response.json() as JsonRpcResponse & {
          result?: { sequence?: number };
        };
        const sequence = data.result?.sequence;
        if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
          throw new Error('RPC getLatestLedger returned an invalid ledger sequence');
        }
        endpoint.latestLedger = sequence;
        endpoint.healthy = true;
        endpoint.ledgerLagged = false;
        endpoint.consecutiveFailures = 0;
        endpoint.lastError = undefined;
        endpoint.score = Math.min(100, endpoint.score + 1);
        return sequence;
      } catch (error) {
        if (signal?.aborted) throw error;
        endpoint.healthy = false;
        endpoint.ledgerLagged = false;
        endpoint.consecutiveFailures++;
        endpoint.lastError = this.getSafeError(error);
        endpoint.score = Math.max(-100, endpoint.score - 10);
        return undefined;
      }
    }));

    const availableLedgers = ledgers.filter((ledger): ledger is number => ledger !== undefined);
    if (availableLedgers.length > 0) {
      const newestLedger = Math.max(...availableLedgers);
      this.endpoints.forEach((endpoint, index) => {
        const ledger = ledgers[index];
        if (ledger !== undefined && newestLedger - ledger > this.maxLedgerLag) {
          endpoint.healthy = false;
          endpoint.ledgerLagged = true;
          endpoint.lastError =
            `Ledger ${ledger} is more than ${this.maxLedgerLag} behind ${newestLedger}`;
          endpoint.score = Math.max(-100, endpoint.score - 10);
        }
      });
    }
    this.updateSingleHealthyAlert();
    return this.getHealth();
  }

  private async requestEndpoint(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort();

    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      if (response.ok === false) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await (typeof response.clone === 'function'
        ? response.clone()
        : response).json() as JsonRpcResponse;
      if (data.error) {
        throw new Error(data.error.message ?? 'Soroban RPC request failed');
      }
      return response;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  private updateSingleHealthyAlert(): void {
    const healthyCount = this.endpoints.filter((endpoint) => endpoint.healthy).length;
    const isSingleHealthy = this.endpoints.length > 1 && healthyCount === 1;
    if (isSingleHealthy && !this.alertedSingleHealthy) {
      this.alertedSingleHealthy = true;
      this.onSingleHealthyEndpoint?.(this.getHealth());
    } else if (!isSingleHealthy) {
      this.alertedSingleHealthy = false;
    }
  }

  private getSafeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/[^\s)]+/g, (value) => {
      try {
        return new URL(value).origin;
      } catch {
        return '[provider URL]';
      }
    });
  }
}
