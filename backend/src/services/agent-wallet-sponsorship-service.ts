import { randomUUID } from 'node:crypto';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { supabase } from '../config/database';
import { env } from '../config/env';
import { secretProvider } from './secret-provider';

export type SponsorshipStatus = 'provisioning' | 'active' | 'reclaim_pending' | 'reclaimed' | 'failed';
export interface AgentWalletRecord {
  id: string; principalPublicKey: string; agentPublicKey: string; secretName: string;
  sponsorPublicKey: string; network: string; assetCode: string; assetIssuer: string;
  status: SponsorshipStatus; createTransactionHash: string | null;
  reclaimTransactionHash: string | null; lastError: string | null;
}
interface Repository {
  create(record: AgentWalletRecord): Promise<void>;
  find(publicKey: string): Promise<AgentWalletRecord | null>;
  update(publicKey: string, patch: Partial<AgentWalletRecord>): Promise<void>;
}
interface Chain {
  create(agent: Keypair): Promise<{ sponsorPublicKey: string; hash: string }>;
  merge(agent: Keypair, sponsorPublicKey: string): Promise<string | null>;
}
interface Secrets {
  rotate(name: string, value: string, version: string, context?: { caller: string; purpose: string }): Promise<unknown>;
  getSecret(name: string, version?: string, context?: { caller: string; purpose: string }): Promise<string | undefined>;
}
const context = (purpose: string) => ({ caller: 'agent-wallet-sponsorship', purpose });

class SupabaseRepository implements Repository {
  async create(r: AgentWalletRecord) {
    const { error } = await supabase.from('agent_account_sponsorships').insert({
      id:r.id, principal_public_key:r.principalPublicKey, agent_public_key:r.agentPublicKey,
      secret_name:r.secretName, sponsor_public_key:r.sponsorPublicKey, network:r.network,
      asset_code:r.assetCode, asset_issuer:r.assetIssuer, status:r.status,
      create_transaction_hash:r.createTransactionHash, reclaim_transaction_hash:r.reclaimTransactionHash,
      last_error:r.lastError,
    });
    if (error) throw new Error(`Unable to persist sponsorship: ${error.message}`);
  }
  async find(publicKey: string): Promise<AgentWalletRecord | null> {
    const { data, error } = await supabase.from('agent_account_sponsorships')
      .select('*').eq('agent_public_key', publicKey).maybeSingle();
    if (error) throw new Error(`Unable to load sponsorship: ${error.message}`);
    if (!data) return null;
    return {
      id:data.id, principalPublicKey:data.principal_public_key, agentPublicKey:data.agent_public_key,
      secretName:data.secret_name, sponsorPublicKey:data.sponsor_public_key, network:data.network,
      assetCode:data.asset_code, assetIssuer:data.asset_issuer, status:data.status,
      createTransactionHash:data.create_transaction_hash, reclaimTransactionHash:data.reclaim_transaction_hash,
      lastError:data.last_error,
    };
  }
  async update(publicKey: string, patch: Partial<AgentWalletRecord>) {
    const columns: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.sponsorPublicKey !== undefined) columns.sponsor_public_key = patch.sponsorPublicKey;
    if (patch.status !== undefined) columns.status = patch.status;
    if (patch.createTransactionHash !== undefined) columns.create_transaction_hash = patch.createTransactionHash;
    if (patch.reclaimTransactionHash !== undefined) columns.reclaim_transaction_hash = patch.reclaimTransactionHash;
    if (patch.lastError !== undefined) columns.last_error = patch.lastError;
    const { error } = await supabase.from('agent_account_sponsorships').update(columns).eq('agent_public_key', publicKey);
    if (error) throw new Error(`Unable to update sponsorship: ${error.message}`);
  }
}

class HorizonChain implements Chain {
  private readonly server: Horizon.Server;
  private readonly passphrase: string;
  private readonly issuer: string;
  constructor(issuer: string, private readonly sponsorSecretName: string, private readonly secrets: Secrets) {
    this.issuer = issuer;
    const network = env.STELLAR_NETWORK;
    const url = env.HORIZON_URL ?? env.STELLAR_HORIZON_URL ??
      (network === 'mainnet' ? 'https://horizon.stellar.org' :
        network === 'futurenet' ? 'https://horizon-futurenet.stellar.org' : 'https://horizon-testnet.stellar.org');
    this.server = new Horizon.Server(url);
    this.passphrase = env.STELLAR_NETWORK_PASSPHRASE ??
      (network === 'mainnet' ? Networks.PUBLIC : network === 'futurenet' ? Networks.FUTURENET : Networks.TESTNET);
  }
  private async sponsor(): Promise<Keypair> {
    const secret = await this.secrets.getSecret(this.sponsorSecretName, undefined, context('pay sponsorship fees and reclaim reserves')) ??
      await this.secrets.getSecret('STELLAR_SECRET_KEY', undefined, context('legacy sponsor key'));
    if (!secret) throw new Error('Configure STELLAR_SPONSOR_SECRET_KEY or STELLAR_SECRET_KEY.');
    return Keypair.fromSecret(secret);
  }
  async create(agent: Keypair) {
    if (!this.issuer) throw new Error('STELLAR_USDC_ISSUER is required.');
    const sponsor = await this.sponsor();
    const account = await this.server.loadAccount(sponsor.publicKey());
    const tx = new TransactionBuilder(account, { fee:'100', networkPassphrase:this.passphrase })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId:agent.publicKey() }))
      .addOperation(Operation.createAccount({ destination:agent.publicKey(), startingBalance:'0' }))
      .addOperation(Operation.changeTrust({ asset:new Asset('USDC',this.issuer), source:agent.publicKey() }))
      .addOperation(Operation.endSponsoringFutureReserves({ source:agent.publicKey() }))
      .setTimeout(30).build();
    tx.sign(sponsor, agent);
    const result = await this.server.submitTransaction(tx);
    return { sponsorPublicKey:sponsor.publicKey(), hash:result.hash };
  }
  async merge(agent: Keypair, sponsorPublicKey: string): Promise<string | null> {
    const sponsor = await this.sponsor();
    if (sponsor.publicKey() !== sponsorPublicKey) throw new Error('Configured sponsor differs from the recorded sponsor.');
    let account: Awaited<ReturnType<Horizon.Server['loadAccount']>>;
    try { account = await this.server.loadAccount(agent.publicKey()); }
    catch (error) {
      const status = (error as { response?: { status?: number }; status?: number }).response?.status ??
        (error as { status?: number }).status;
      if (status === 404) return null;
      throw error;
    }
    const trustline = account.balances.find((b) => b.asset_type !== 'native' &&
      'asset_code' in b && b.asset_code === 'USDC' && 'asset_issuer' in b && b.asset_issuer === this.issuer);
    if (trustline && Number(trustline.balance) > 0) {
      throw new Error('Agent still holds USDC; settle or transfer its token balance before reserve reclamation.');
    }
    const sponsorAccount = await this.server.loadAccount(sponsor.publicKey());
    const tx = new TransactionBuilder(sponsorAccount, { fee:'100', networkPassphrase:this.passphrase })
      .addOperation(Operation.changeTrust({ asset:new Asset('USDC', this.issuer), limit:'0', source:agent.publicKey() }))
      .addOperation(Operation.accountMerge({ destination:sponsor.publicKey(), source:agent.publicKey() }))
      .setTimeout(30).build();
    tx.sign(sponsor, agent);
    return (await this.server.submitTransaction(tx)).hash;
  }
}

export class AgentWalletSponsorshipService {
  readonly enabled: boolean;
  private readonly issuer: string;
  private readonly repository: Repository;
  private readonly chain: Chain;
  private readonly secrets: Secrets;
  private readonly network: string;
  private readonly sponsorSecretName: string;
  constructor(options?: {
    enabled?: boolean; issuer?: string; network?: string; sponsorSecretName?: string;
    repository?: Repository; chain?: Chain; secrets?: Secrets;
  }) {
    this.enabled = options?.enabled ?? env.SPONSORED_AGENT_ACCOUNTS_ENABLED === 'true';
    this.issuer = options?.issuer ?? env.STELLAR_USDC_ISSUER ?? '';
    this.network = options?.network ?? env.STELLAR_NETWORK;
    this.sponsorSecretName = options?.sponsorSecretName ?? 'STELLAR_SPONSOR_SECRET_KEY';
    this.secrets = options?.secrets ?? secretProvider;
    this.repository = options?.repository ?? new SupabaseRepository();
    this.chain = options?.chain ?? new HorizonChain(this.issuer, this.sponsorSecretName, this.secrets);
  }
  async createAgentWallet(principalPublicKey: string) {
    if (!this.enabled) throw new Error('Sponsored agent accounts are disabled.');
    if (!this.issuer) throw new Error('STELLAR_USDC_ISSUER must be configured.');
    const id = randomUUID(), keypair = Keypair.random(), secretName = `syncro/agent-wallets/${id}`;
    await this.secrets.rotate(secretName, keypair.secret(), randomUUID().replace(/-/g, ''), context('store generated agent signing key'));
    await this.repository.create({
      id, principalPublicKey, agentPublicKey:keypair.publicKey(), secretName, sponsorPublicKey:'',
      network:this.network, assetCode:'USDC', assetIssuer:this.issuer, status:'provisioning',
      createTransactionHash:null, reclaimTransactionHash:null, lastError:null,
    });
    let submitted: { sponsorPublicKey:string; hash:string };
    try { submitted = await this.chain.create(keypair); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.update(keypair.publicKey(), { status:'failed', lastError:message });
      throw error;
    }
    try {
      await this.repository.update(keypair.publicKey(), {
        sponsorPublicKey:submitted.sponsorPublicKey, status:'active',
        createTransactionHash:submitted.hash, lastError:null,
      });
    } catch (error) {
      // Preserve the provisioning row for reconciliation; never report a wallet as active
      // when the durable sponsorship record could not be updated.
      throw new Error('Sponsored account was created, but its record could not be finalized. Reconcile the provisioning record before retrying.');
    }
    return { publicKey:keypair.publicKey(), sponsorshipStatus:'active' as const, transactionHash:submitted.hash };
  }
  async reclaimSponsoredAccount(publicKey: string): Promise<boolean> {
    const record = await this.repository.find(publicKey);
    if (!record) return false;
    if (record.status === 'reclaimed') return true;
    if (record.status !== 'active' && record.status !== 'reclaim_pending') {
      throw new Error(`Cannot reclaim wallet in ${record.status} state.`);
    }
    const secret = await this.secrets.getSecret(record.secretName, undefined, context('sign sponsored account merge on revoke'));
    if (!secret) throw new Error('Managed agent signing key is missing from the secret provider.');
    try {
      const hash = await this.chain.merge(Keypair.fromSecret(secret), record.sponsorPublicKey);
      await this.repository.update(publicKey, { status:'reclaimed', reclaimTransactionHash:hash, lastError:null });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.update(publicKey, { status:'reclaim_pending', lastError:message });
      throw error;
    }
  }
}
export const agentWalletSponsorshipService = new AgentWalletSponsorshipService();
