import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CounterStoreService } from './counter-store.service';
import { SorobanRpcService } from './soroban-rpc.service';
import { SettlementSignerService } from './settlement-signer.service';

export interface DependencyCheck {
  name: string;
  ok: boolean;
  detail?: string;
  latencyMs?: number;
}

export interface ReadinessResult {
  ready: boolean;
  checks: DependencyCheck[];
}

const DEFAULT_CHECK_TIMEOUT_MS = 2000;
const DEFAULT_MIN_SIGNER_BALANCE = '1';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly counterStore: CounterStoreService,
    private readonly sorobanRpc: SorobanRpcService,
    private readonly settlementSigner: SettlementSignerService,
  ) {}

  /**
   * Liveness: the process is up and able to respond. Does not touch any
   * external dependency, so a broken meter store / RPC / signer will not
   * cause the orchestrator to restart a healthy process.
   */
  liveness(): { live: boolean } {
    return { live: true };
  }

  /**
   * Readiness: the instance can serve paid calls. Fails when any v3
   * dependency (counter store, Soroban RPC, settlement signer) is down.
   */
  async readiness(): Promise<ReadinessResult> {
    const checks = await Promise.all([
      this.checkCounterStore(),
      this.checkSorobanRpc(),
      this.checkSettlementSigner(),
    ]);

    const ready = checks.every((check) => check.ok);
    if (!ready) {
      this.logger.warn(
        `Readiness failed: ${checks
          .filter((c) => !c.ok)
          .map((c) => `${c.name} (${c.detail ?? 'unknown'})`)
          .join(', ')}`,
      );
    }

    return { ready, checks };
  }

  private async checkCounterStore(): Promise<DependencyCheck> {
    return this.runCheck('counter_store', async () => {
      const reachable = await this.counterStore.ping();
      if (!reachable) {
        throw new Error('counter store unreachable');
      }
    });
  }

  private async checkSorobanRpc(): Promise<DependencyCheck> {
    return this.runCheck('soroban_rpc', async () => {
      const latestLedger = await this.sorobanRpc.getLatestLedger();
      const maxAgeLedgers = this.config.get<number>(
        'SOROBAN_MAX_LEDGER_AGE',
        120,
      );
      const currentLedger = await this.sorobanRpc.getCurrentLedger();
      const age = currentLedger - latestLedger;
      if (age > maxAgeLedgers) {
        throw new Error(
          `latest ledger ${latestLedger} is ${age} ledgers behind (max ${maxAgeLedgers})`,
        );
      }
    });
  }

  private async checkSettlementSigner(): Promise<DependencyCheck> {
    return this.runCheck('settlement_signer', async () => {
      const minBalance = this.config.get<string>(
        'SETTLEMENT_SIGNER_MIN_BALANCE',
        DEFAULT_MIN_SIGNER_BALANCE,
      );
      const balance = await this.settlementSigner.getAccountBalance();
      if (Number(balance) < Number(minBalance)) {
        throw new Error(
          `signer balance ${balance} below threshold ${minBalance}`,
        );
      }
    });
  }

  private async runCheck(
    name: string,
    fn: () => Promise<void>,
  ): Promise<DependencyCheck> {
    const timeoutMs = this.config.get<number>(
      'HEALTH_CHECK_TIMEOUT_MS',
      DEFAULT_CHECK_TIMEOUT_MS,
    );
    const startedAt = Date.now();

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      return { name, ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
