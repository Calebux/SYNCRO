import logger from '../config/logger';
import { supabase } from '../config/database';
import { env } from '../config/env';
import {
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { secretProvider } from './secret-provider';
import { getBlockchainFlags, resolveStellarNetwork } from '../../../shared/blockchain-flags';

// ============================================================================
// TYPES
// ============================================================================

export type ProposalState =
  | 'Pending' | 'Approved' | 'Ready' | 'Executed' | 'Cancelled' | 'RolledBack';

export interface UpgradeProposal {
  id: string;
  proposalId: number;
  targetContract: string;
  newWasmHash: string;
  previousWasmHash: string;
  description: string;
  proposer: string;
  state: ProposalState;
  createdAt: string;
  approvedAt: string | null;
  executableAt: string | null;
  approvedBy: string[];
}

export interface ContractUpgradeEvent {
  id: string;
  proposalId: number;
  eventType: 'proposed' | 'approved' | 'ready' | 'executed' | 'rolled_back' | 'cancelled';
  transactionHash: string;
  blockNumber: number;
  timestamp: string;
  data: Record<string, unknown>;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ContractUpgradeService {
  private contractAddress: string;
  private rpcUrl: string;
  private networkPassphrase: string;

  constructor() {
    const addr = env.SOROBAN_UPGRADE_ADDRESS;
    if (!addr) {
      logger.warn('[contract-upgrade] SOROBAN_UPGRADE_ADDRESS not configured');
    }
    this.contractAddress = addr || '';
    const flags = getBlockchainFlags();
    const network = resolveStellarNetwork();
    const configuredRpc = env.SOROBAN_RPC_URL;
    if (!configuredRpc && flags.isProduction) {
      throw new Error('[contract-upgrade] SOROBAN_RPC_URL must be set in production.');
    }
    this.rpcUrl = configuredRpc || 'https://soroban-testnet.stellar.org';
    const configuredPassphrase = env.STELLAR_NETWORK_PASSPHRASE;
    if (!configuredPassphrase && flags.isProduction) {
      throw new Error('[contract-upgrade] STELLAR_NETWORK_PASSPHRASE must be set in production.');
    }
    this.networkPassphrase = configuredPassphrase || Networks.TESTNET;
  }

  get isEnabled(): boolean {
    return !!this.contractAddress;
  }

  // --------------------------------------------------------------------------
  // QUERY METHODS
  // --------------------------------------------------------------------------

  async getGuardians(): Promise<{ address: string }[]> {
    this.ensureEnabled();
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sourceKeypair = await this.getSigningKeypair();
    const account = await rpc.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_guardians'))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    if (sim.result?.retval) {
      const val = sim.result.retval;
      if (val.switch() === xdr.ScValType.scvVec()) {
        const vec = val.vec();
        return vec
          .map((v: xdr.ScVal) => ({
            address: v.address()?.toString() || '',
          }))
          .filter((g: { address: string }) => g.address);
      }
    }
    return [];
  }

  async getProposal(proposalId: number): Promise<UpgradeProposal | null> {
    this.ensureEnabled();
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sourceKeypair = await this.getSigningKeypair();
    const account = await rpc.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_proposal', xdr.ScVal.scvU64(new xdr.Uint64(proposalId))))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    if (sim.result?.retval) {
      return this.parseProposalFromScVal(sim.result.retval);
    }
    return null;
  }

  async getProposalCount(): Promise<number> {
    this.ensureEnabled();
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sourceKeypair = await this.getSigningKeypair();
    const account = await rpc.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_proposal_count'))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }

    if (sim.result?.retval) {
      return Number(sim.result.retval.u64()?.toString() || '0');
    }
    return 0;
  }

  async getTimelock(): Promise<number> {
    this.ensureEnabled();
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sourceKeypair = await this.getSigningKeypair();
    const account = await rpc.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_timelock'))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    if (sim.result?.retval) {
      return Number(sim.result.retval.u64()?.toString() || '0');
    }
    return 172800;
  }

  async isPaused(): Promise<boolean> {
    this.ensureEnabled();
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sourceKeypair = await this.getSigningKeypair();
    const account = await rpc.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('is_paused'))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    if (sim.result?.retval) {
      return sim.result.retval.bool() === true;
    }
    return false;
  }

  async isRollbackAvailable(targetContract: string): Promise<boolean> {
    this.ensureEnabled();
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sourceKeypair = await this.getSigningKeypair();
    const account = await rpc.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('is_rollback_available', this.addressToScVal(targetContract)))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    if (sim.result?.retval) {
      return sim.result.retval.bool() === true;
    }
    return false;
  }

  async getGovernedContracts(): Promise<string[]> {
    this.ensureEnabled();
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sourceKeypair = await this.getSigningKeypair();
    const account = await rpc.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_governed_contracts'))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Simulation failed: ${sim.error}`);
    }
    if (sim.result?.retval?.switch() === xdr.ScValType.scvVec()) {
      return (sim.result.retval.vec() ?? [])
        .map((v: xdr.ScVal) => v.address()?.toString() || '')
        .filter(Boolean);
    }
    return [];
  }
  // --------------------------------------------------------------------------
  // TRANSACTION METHODS
  // --------------------------------------------------------------------------

  async proposeUpgrade(params: {
    proposerSecret: string; targetContract: string;
    newWasmHash: string; previousWasmHash: string; description: string;
  }): Promise<{ proposalId: number; transactionHash: string }> {
    this.ensureEnabled();
    const { proposerSecret, targetContract, newWasmHash, previousWasmHash, description } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(proposerSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(
        'propose_upgrade',
        this.addressToScVal(sk.publicKey()),
        this.addressToScVal(targetContract),
        this.hexToBytesN(newWasmHash),
        this.hexToBytesN(previousWasmHash),
        xdr.ScVal.scvString(description),
      ))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");

    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");

    let proposalId = 0;
    if (sim.result?.retval) {
      proposalId = Number(sim.result.retval.u64()?.toString() || '0');
    }
    await this.logEvent({ proposalId, eventType: 'proposed', transactionHash: result.hash, data: { targetContract, description } });
    return { proposalId, transactionHash: result.hash };
  }

  async approveUpgrade(params: { guardianSecret: string; proposalId: number }): Promise<{ transactionHash: string }> {
    this.ensureEnabled();
    const { guardianSecret, proposalId } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(guardianSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(
        'approve_upgrade',
        xdr.ScVal.scvU64(new xdr.Uint64(proposalId)),
        this.addressToScVal(sk.publicKey()),
      ))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");
    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");

    await this.logEvent({ proposalId, eventType: 'approved', transactionHash: result.hash, data: {} });
    return { transactionHash: result.hash };
  }

  async executeUpgrade(params: {
    executorSecret: string;
    proposalId: number;
    targetContract: string;
    newWasmHash: string;
  }): Promise<{ transactionHash: string }> {
    this.ensureEnabled();
    const { executorSecret, proposalId, targetContract, newWasmHash } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(executorSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(
        'execute_upgrade',
        xdr.ScVal.scvU64(new xdr.Uint64(proposalId)),
        this.addressToScVal(sk.publicKey()),
        this.addressToScVal(targetContract),
        this.hexToBytesN(newWasmHash),
      ))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");
    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");

    await this.logEvent({
      proposalId,
      eventType: 'executed',
      transactionHash: result.hash,
      data: { newWasmHash, targetContract },
    });
    return { transactionHash: result.hash };
  }

  async executeBatchUpgrade(params: {
    executorSecret: string;
    proposalId: number;
  }): Promise<{ transactionHash: string }> {
    this.ensureEnabled();
    const { executorSecret, proposalId } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(executorSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(
        'execute_batch_upgrade',
        xdr.ScVal.scvU64(new xdr.Uint64(proposalId)),
        this.addressToScVal(sk.publicKey()),
      ))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");
    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");

    await this.logEvent({
      proposalId,
      eventType: 'executed',
      transactionHash: result.hash,
      data: { batch: true },
    });
    return { transactionHash: result.hash };
  }

  async registerGovernedContract(params: {
    adminSecret: string;
    targetContract: string;
    timelockSeconds?: number;
  }): Promise<{ transactionHash: string }> {
    this.ensureEnabled();
    const { adminSecret, targetContract, timelockSeconds = 0 } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(adminSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(
        'register_governed_contract',
        this.addressToScVal(targetContract),
        xdr.ScVal.scvU64(new xdr.Uint64(timelockSeconds)),
      ))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");
    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");
    return { transactionHash: result.hash };
  }

  async proposeBatchUpgrade(params: {
    proposerSecret: string;
    targets: string[];
    newWasmHashes: string[];
    previousWasmHashes: string[];
    description: string;
  }): Promise<{ proposalId: number; transactionHash: string }> {
    this.ensureEnabled();
    const { proposerSecret, targets, newWasmHashes, previousWasmHashes, description } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(proposerSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(
        'propose_batch_upgrade',
        this.addressToScVal(sk.publicKey()),
        xdr.ScVal.scvVec(targets.map((t) => this.addressToScVal(t))),
        xdr.ScVal.scvVec(newWasmHashes.map((h) => this.hexToBytesN(h))),
        xdr.ScVal.scvVec(previousWasmHashes.map((h) => this.hexToBytesN(h))),
        xdr.ScVal.scvString(description),
      ))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");
    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");

    let proposalId = 0;
    if (sim.result?.retval) {
      proposalId = Number(sim.result.retval.u64()?.toString() || '0');
    }
    await this.logEvent({
      proposalId,
      eventType: 'proposed',
      transactionHash: result.hash,
      data: { targets, description, batch: true },
    });
    return { proposalId, transactionHash: result.hash };
  }

  async rollbackUpgrade(params: {
    callerSecret: string;
    targetContract: string;
    previousWasmHash: string;
  }): Promise<{ transactionHash: string }> {
    this.ensureEnabled();
    const { callerSecret, targetContract, previousWasmHash } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(callerSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(
        'rollback_upgrade',
        this.addressToScVal(sk.publicKey()),
        this.addressToScVal(targetContract),
        this.hexToBytesN(previousWasmHash),
      ))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");
    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");

    await this.logEvent({ proposalId: 0, eventType: 'rolled_back', transactionHash: result.hash, data: { previousWasmHash } });
    return { transactionHash: result.hash };
  }

  async cancelProposal(params: { adminSecret: string; proposalId: number }): Promise<{ transactionHash: string }> {
    this.ensureEnabled();
    const { adminSecret, proposalId } = params;
    const rpc = new SorobanRpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractAddress);
    const sk = Keypair.fromSecret(adminSecret);
    const account = await rpc.getAccount(sk.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: '100', networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('cancel_proposal', xdr.ScVal.scvU64(new xdr.Uint64(proposalId))))
      .setTimeout(30).build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed");
    const prepared = SorobanRpc.assembleTransaction(tx, sim);
    const signed = prepared.sign(sk);
    const result = await rpc.sendTransaction(signed);
    if (result.status === 'ERROR') throw new Error("Transaction failed");

    await this.logEvent({ proposalId, eventType: 'cancelled', transactionHash: result.hash, data: {} });
    return { transactionHash: result.hash };
  }
  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private ensureEnabled(): void {
    if (!this.contractAddress) {
      throw new Error('Contract upgrade service not configured. Set SOROBAN_UPGRADE_ADDRESS.');
    }
  }

  private async getSigningKeypair(): Promise<Keypair> {
    const secret = await secretProvider.getSecret('STELLAR_SECRET_KEY');
    if (!secret) throw new Error('STELLAR_SECRET_KEY not configured');
    return Keypair.fromSecret(secret);
  }

  private addressToScVal(address: string): xdr.ScVal {
    const pk = Keypair.fromPublicKey(address);
    return xdr.ScVal.scvAddress(
      xdr.ScAddress.scaAccountType(
        xdr.PublicKey.publicKeyTypeEd25519(
          xdr.Uint256.fromBytes(Buffer.from(pk.rawPublicKey(), 'hex')),
        ),
      ),
    );
  }

  private hexToBytesN(hex: string): xdr.ScVal {
    const bytes = Buffer.from(hex.replace('0x', ''), 'hex');
    const padded = Buffer.alloc(32, 0);
    bytes.copy(padded, 32 - bytes.length);
    return xdr.ScVal.scvBytes(padded);
  }

  private parseProposalFromScVal(val: xdr.ScVal): UpgradeProposal | null {
    try {
      if (val.switch() !== xdr.ScValType.scvVec()) return null;
      const vec = val.vec();
      if (!vec || vec.length < 10) return null;
      return {
        id: vec[0]?.u64()?.toString() || '0',
        proposalId: Number(vec[0]?.u64()?.toString() || '0'),
        description: vec[1]?.str()?.toString() || '',
        targetContract: vec[2]?.address()?.toString() || vec[2]?.str()?.toString() || '',
        newWasmHash: vec[3]?.bytes()?.toString('hex') || '',
        proposer: vec[4]?.address()?.toString() || '',
        state: this.parseProposalState(vec[5]),
        createdAt: vec[6]?.u64()?.toString() || '0',
        approvedAt: vec[7]?.u64()?.toString() || null,
        executableAt: vec[8]?.u64()?.toString() || null,
        previousWasmHash: vec[9]?.bytes()?.toString('hex') || '',
        approvedBy: [],
      };
    } catch (err) {
      logger.error('Failed to parse proposal from ScVal:', err);
      return null;
    }
  }

  private parseProposalState(val: xdr.ScVal): ProposalState {
    const num = val.u32()?.toString() || '0';
    const states: Record<string, ProposalState> = {
      '0': 'Pending', '1': 'Approved', '2': 'Ready',
      '3': 'Executed', '4': 'Cancelled', '5': 'RolledBack',
    };
    return states[num] || 'Pending';
  }

  private async logEvent(params: {
    proposalId: number; eventType: ContractUpgradeEvent['eventType'];
    transactionHash: string; data: Record<string, unknown>;
  }): Promise<void> {
    try {
      await supabase.from('contract_upgrade_events').insert({
        proposal_id: params.proposalId,
        event_type: params.eventType,
        transaction_hash: params.transactionHash,
        data: params.data,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Failed to log contract upgrade event:', err);
    }
  }

  async getUpgradeEvents(limit = 20): Promise<ContractUpgradeEvent[]> {
    try {
      const { data, error } = await supabase
        .from('contract_upgrade_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        proposalId: row.proposal_id as number,
        eventType: row.event_type as ContractUpgradeEvent['eventType'],
        transactionHash: row.transaction_hash as string,
        blockNumber: 0,
        timestamp: row.created_at as string,
        data: (row.data || {}) as Record<string, unknown>,
      }));
    } catch (err) {
      logger.error('Failed to fetch upgrade events:', err);
      return [];
    }
  }
}

export const contractUpgradeService = new ContractUpgradeService();
