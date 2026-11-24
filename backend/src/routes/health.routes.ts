import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { SorobanRpc, Keypair, Networks, Asset, Horizon } from '@stellar/stellar-sdk';

const router = Router();
const prisma = new PrismaClient();

const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? 3000);
const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const SETTLEMENT_SIGNER_SECRET = process.env.SETTLEMENT_SIGNER_SECRET ?? '';
const SIGNER_MIN_BALANCE_XLM = Number(process.env.SETTLEMENT_SIGNER_MIN_BALANCE_XLM ?? 5);
const MAX_LEDGER_AGE_SECONDS = Number(process.env.SOROBAN_MAX_LEDGER_AGE_SECONDS ?? 120);

interface CheckResult {
  ok: boolean;
  detail?: string;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${CHECK_TIMEOUT_MS}ms`)),
      CHECK_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function checkMeterStore(): Promise<CheckResult> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 'meter store');
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

async function checkSorobanRpc(): Promise<CheckResult> {
  try {
    const server = new SorobanRpc.Server(RPC_URL);
    const latest = await withTimeout(server.getLatestLedger(), 'soroban rpc');
    const ageSeconds = Math.floor(Date.now() / 1000) - Number(latest.closeTime ?? 0);
    if (Number.isFinite(ageSeconds) && ageSeconds > MAX_LEDGER_AGE_SECONDS) {
      return {
        ok: false,
        detail: `latest ledger is ${ageSeconds}s old (max ${MAX_LEDGER_AGE_SECONDS}s)`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

async function checkSettlementSigner(): Promise<CheckResult> {
  if (!SETTLEMENT_SIGNER_SECRET) {
    return { ok: false, detail: 'SETTLEMENT_SIGNER_SECRET is not configured' };
  }
  try {
    const keypair = Keypair.fromSecret(SETTLEMENT_SIGNER_SECRET);
    const horizon = new Horizon.Server(HORIZON_URL);
    const account = await withTimeout(horizon.loadAccount(keypair.publicKey()), 'settlement signer');
    const native = account.balances.find((b) => b.asset_type === 'native');
    const balance = native ? Number(native.balance) : 0;
    if (!Number.isFinite(balance) || balance < SIGNER_MIN_BALANCE_XLM) {
      return {
        ok: false,
        detail: `signer balance ${balance} XLM below threshold ${SIGNER_MIN_BALANCE_XLM} XLM`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

// Liveness: process is up. Does not touch external dependencies.
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness: can serve paid calls. Fails if any v3 dependency is down.
router.get('/ready', async (_req: Request, res: Response) => {
  const [meterStore, sorobanRpc, settlementSigner] = await Promise.all([
    checkMeterStore(),
    checkSorobanRpc(),
    checkSettlementSigner(),
  ]);

  const checks = { meterStore, sorobanRpc, settlementSigner };
  const ready = Object.values(checks).every((c) => c.ok);

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
  });
});

// Backwards-compatible health endpoint.
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

export default router;
