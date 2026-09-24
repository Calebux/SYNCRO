import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { InMemoryProviderStore, RegisterProviderInput, RegisterRouteInput } from './provider-store';
import { ReceiptService } from './receipt-service';
import { AgentRegistryReader, ScopeEnforcer } from './scope-enforcer';
import {
  AgentRegistryGrant,
  PaidReceipt,
  ProviderRegistration,
  RegisteredRoute,
  ScopeRejectionError,
} from './types';

export interface UpstreamResult {
  status: number;
  body: unknown;
}

export interface UpstreamCaller {
  call(args: {
    upstreamBaseUrl: string;
    method: string;
    path: string;
    body: unknown;
  }): Promise<UpstreamResult>;
}

export interface PaidCallInput {
  providerId: string;
  method: string;
  path: string;
  body: unknown;
  query: Record<string, unknown>;
  agentId: string;
  quantity?: number;
  exchangeRate?: number | null;
  channelId: string;
  stateNonce: number;
  rateCardVersion: string;
}

export class InMemoryAgentRegistryReader implements AgentRegistryReader {
  private readonly grants = new Map<string, AgentRegistryGrant>();

  setGrant(grant: AgentRegistryGrant): void {
    this.grants.set(grant.agentId, grant);
  }

  async getGrant(agentId: string): Promise<AgentRegistryGrant> {
    const grant = this.grants.get(agentId);
    if (!grant) {
      throw new Error('grant not found');
    }
    return grant;
  }
}

export class V3GatewayService {
  constructor(
    private readonly providers: InMemoryProviderStore,
    private readonly enforcer: ScopeEnforcer,
    private readonly receipts: ReceiptService,
    private readonly upstream: UpstreamCaller,
  ) {}

  registerProvider(input: RegisterProviderInput): ProviderRegistration {
    return this.providers.registerProvider(input);
  }

  createPayoutChallenge(providerId: string): { challenge: string } {
    const provider = this.getProviderOrThrow(providerId);
    const challenge = `syncro-payout:${provider.providerId}:${randomUUID()}`;
    provider.payoutChallenge = challenge;
    this.providers.saveProvider(provider);
    return { challenge };
  }

  verifyPayoutChallenge(providerId: string, signatureBase64: string): ProviderRegistration {
    const provider = this.getProviderOrThrow(providerId);
    if (!provider.payoutChallenge) {
      throw new Error('payout challenge not created');
    }

    const signature = Buffer.from(signatureBase64, 'base64');
    const verified = Keypair.fromPublicKey(provider.payoutAddress).verify(
      Buffer.from(provider.payoutChallenge),
      signature,
    );

    if (!verified) {
      throw new Error('invalid payout signature');
    }

    provider.payoutVerified = true;
    provider.payoutChallenge = null;
    this.providers.saveProvider(provider);
    return provider;
  }

  registerRoute(input: RegisterRouteInput): RegisteredRoute {
    const provider = this.getProviderOrThrow(input.providerId);
    if (!provider.payoutVerified) {
      throw new Error('payout address must be verified before route registration');
    }
    return this.providers.registerRoute(input);
  }

  async processPaidCall(input: PaidCallInput): Promise<{
    upstream: UpstreamResult;
    receipt: PaidReceipt;
    route: RegisteredRoute;
    inlineReceiptHeader: string | null;
  }> {
    const provider = this.getProviderOrThrow(input.providerId);
    if (!provider.payoutVerified) {
      throw new Error('provider payout address is not verified');
    }
    if (provider.mode === 'production' && process.env.STELLAR_NETWORK !== 'mainnet') {
      throw new Error('production providers require mainnet runtime');
    }

    const route = this.providers.findRoute(input.providerId, input.method, input.path);
    if (!route) {
      throw new Error('route not registered for provider');
    }

    await this.enforcer.assertAllowed({
      agentId: input.agentId,
      routeScope: route.scopeKey,
    });

    const quantity = input.quantity ?? 1;
    const amount = route.price * quantity;

    const upstream = await this.upstream.call({
      upstreamBaseUrl: provider.upstreamBaseUrl,
      method: input.method,
      path: input.path,
      body: input.body,
    });

    const receipt = this.receipts.issueReceipt({
      receiptId: randomUUID(),
      route: route.scopeKey,
      unit: route.unit,
      quantity,
      amount,
      rateCardVersion: input.rateCardVersion,
      exchangeRate: input.exchangeRate ?? null,
      channelId: input.channelId,
      stateNonce: input.stateNonce,
      requestMethod: input.method,
      requestPath: input.path,
      requestQuery: input.query,
    });

    return {
      upstream,
      route,
      receipt,
      inlineReceiptHeader: this.receipts.headerFitsInline(receipt)
        ? this.receipts.encodeHeaderValue(receipt)
        : null,
    };
  }

  getReceipt(receiptId: string): PaidReceipt | null {
    return this.receipts.getReceipt(receiptId);
  }

  isScopeError(error: unknown): error is ScopeRejectionError {
    return error instanceof ScopeRejectionError;
  }

  private getProviderOrThrow(providerId: string): ProviderRegistration {
    const provider = this.providers.getProvider(providerId);
    if (!provider) {
      throw new Error('provider not found');
    }
    return provider;
  }
}

