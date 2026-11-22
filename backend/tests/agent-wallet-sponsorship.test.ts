import { Keypair } from '@stellar/stellar-sdk';
import { AgentWalletSponsorshipService, AgentWalletRecord } from '../src/services/agent-wallet-sponsorship-service';

class MemoryRepository {
  records=new Map<string,AgentWalletRecord>();
  async create(record:AgentWalletRecord) { this.records.set(record.agentPublicKey,{...record}); }
  async find(key:string) { return this.records.get(key) ?? null; }
  async update(key:string,patch:Partial<AgentWalletRecord>) {
    const current=this.records.get(key); if(current) this.records.set(key,{...current,...patch});
  }
}
describe('managed Stellar agent sponsorships (#1858)',()=>{
  it('stores generated signing keys outside the database and provisions sponsored account/trustline',async()=>{
    const repository=new MemoryRepository(), secretsMap=new Map<string,string>();
    const secrets={rotate:jest.fn(async(name:string,value:string)=>{secretsMap.set(name,value);}),getSecret:jest.fn(async(name:string)=>secretsMap.get(name))};
    const chain={create:jest.fn(async()=>({sponsorPublicKey:Keypair.random().publicKey(),hash:'create-hash'})),merge:jest.fn()};
    const service=new AgentWalletSponsorshipService({enabled:true,issuer:Keypair.random().publicKey(),network:'testnet',repository,chain,secrets});
    const result=await service.createAgentWallet(Keypair.random().publicKey());
    expect(result.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(result.transactionHash).toBe('create-hash');
    expect(chain.create).toHaveBeenCalledTimes(1);
    expect(repository.records.get(result.publicKey)?.status).toBe('active');
    expect(secretsMap.size).toBe(1);
    expect(secretsMap.values().next().value).toMatch(/^S[A-Z2-7]{55}$/);
  });
  it('merges a managed agent on revoke and records reserve reclamation idempotently',async()=>{
    const repository=new MemoryRepository(), key=Keypair.random(), secretName='syncro/agent-wallets/test';
    const record:AgentWalletRecord={id:'test',principalPublicKey:Keypair.random().publicKey(),agentPublicKey:key.publicKey(),secretName,sponsorPublicKey:Keypair.random().publicKey(),network:'testnet',assetCode:'USDC',assetIssuer:Keypair.random().publicKey(),status:'active',createTransactionHash:'create-hash',reclaimTransactionHash:null,lastError:null};
    await repository.create(record);
    const chain={create:jest.fn(),merge:jest.fn(async()=> 'merge-hash')};
    const service=new AgentWalletSponsorshipService({enabled:true,issuer:record.assetIssuer,network:'testnet',repository,chain,secrets:{rotate:jest.fn(),getSecret:async()=>key.secret()}});
    await expect(service.reclaimSponsoredAccount(key.publicKey())).resolves.toBe(true);
    expect(chain.merge).toHaveBeenCalledWith(expect.any(Keypair),record.sponsorPublicKey);
    expect(repository.records.get(key.publicKey())?.status).toBe('reclaimed');
    await service.reclaimSponsoredAccount(key.publicKey());
    expect(chain.merge).toHaveBeenCalledTimes(1);
  });
  it('keeps a retryable record when reclaim fails because USDC remains in the account',async()=>{
    const repository=new MemoryRepository(), key=Keypair.random(), secretName='syncro/agent-wallets/pending';
    await repository.create({id:'pending',principalPublicKey:Keypair.random().publicKey(),agentPublicKey:key.publicKey(),secretName,sponsorPublicKey:Keypair.random().publicKey(),network:'testnet',assetCode:'USDC',assetIssuer:Keypair.random().publicKey(),status:'active',createTransactionHash:'create-hash',reclaimTransactionHash:null,lastError:null});
    const service=new AgentWalletSponsorshipService({enabled:true,issuer:Keypair.random().publicKey(),network:'testnet',repository,chain:{create:jest.fn(),merge:jest.fn(async()=>{throw new Error('USDC balance is non-zero');})},secrets:{rotate:jest.fn(),getSecret:async()=>key.secret()}});
    await expect(service.reclaimSponsoredAccount(key.publicKey())).rejects.toThrow('USDC balance is non-zero');
    expect(repository.records.get(key.publicKey())?.status).toBe('reclaim_pending');
  });
});
