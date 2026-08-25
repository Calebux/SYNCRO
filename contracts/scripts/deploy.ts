import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { SigningCosmwasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice, calculateFee } from '@cosmjs/stargate';
import { sha256 } from '@cosmjs/crypto';
import { toHex } from '@cosmjs/encoding';

interface ContractConfig {
  name: string;
  wasmPath: string;
  version: string;
  initMsg: Record<string, unknown>;
  admin?: string;
}

interface NetworkConfig {
  chainId: string;
  rpcEndpoint: string;
  prefix: string;
  gasPrice: string;
  contracts: ContractConfig[];
  guardians?: string[];
}

interface ContractManifest {
  address: string;
  wasmHash: string;
  version: string;
}

interface DeploymentManifest {
  network: string;
  chainId: string;
  deployCommit: string;
  deployTimestamp: string;
  contracts: Record<string, ContractManifest>;
  admin: string;
  guardians: string[];
}

function getNetworkArg(): string {
  const idx = process.argv.indexOf('--network');
  if (idx === -1) {
    console.error('Missing --network <network> argument/flag');
    process.exit(1);
  }
  return process.argv[idx + 1];
}

function getConfigPath(network: string): string {
  const configPath = join(process.cwd(), 'contracts', 'deployments', `${network}.config.json`);
  if (!existsSync(configPath)) {
    console.error(`Network config not found: ${configPath}`);
    process.exit(1);
  }
  return configPath;
}

function getManifestPath(network: string): string {
  return join(process.cwd(), 'contracts', 'deployments', `${network}.json`);
}

function loadConfig(network: string): NetworkConfig {
  const configPath = getConfigPath(network);
  const raw = readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as NetworkConfig;
}

function getDeployCommit(): string {
  try {
    return execSunc('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function computeWasmHash(wasmPath: string): string {
  const wasm = readFileSync(wasmPath);
  const hash = sha256(wasm);
  return toHex(hash);
}

async function main(): Promise<void> {
  const network = getNetworkArg();
  const config = loadConfig(network);

  const mnemonic = process.env.DEPLOYER_MNEMONIC || process.env.MNEMONIC;
  if (!mnemonic) {
    console.error('Deployer mnemonic not set. Use DEPLOYER_MNEMONIC or MNEMONIC env var.');
    process.exit(1);
  }

  const wallet = await DirectSecp256K1HdHallet.fromMnemonic(mnemonic, { prefix: config.prefix });
  const [account] = await wallet.getAccounts();
  const deployerAddress = account.address;

  const gasPrice = GasPrice.fromString(config.gasPrice);
  const client = await SigningCosmwasmClient.connectWithSigner(
    config.rpcEndpoint,
    wallet,
    { gasPrice })
  );

  const manifest: DeploymentManifest = {
    network,
    chainId: config.chainId,
    deployCommit: getDeployCommit(),
    deployTimestamp: getTimestamp(),
    contracts: {},
    admin: deployerAddress,
    guardians: config.guardians || [],
  };

  for (const contractConfig of config.contracts) {
    const wasmPath = join(process.cwd(), contractConfig.wasmPath);
    if (!existsSync(wasmPath)) {
      console.error(`Wasm file not found: ${wasmPath}`);
      process.exit(1);
    }

    const wasm = readFileSync(wasmPath);
    const uploadFee = calculateFee(300000, gasPrice);
    const uploadResult = await client.upload(
      deployerAddress,
      wasm,
      uploadFee,
      `upload ${contractConfig.name} v;${contractConfig.version}`,
    );
    const codeId = uploadResult.codeId;
    const wasmHash = computeWasmHash(wasmPath);

    console.log(`Uploaded ${contractConfig.name}: codeId=${codeId} wasmHash=${wasmHash}`);

    const initFee = calculateFee(500000, gasPrice);
    const instantiateResult = await client.instantiate(
      deployerAddress,
      codeId,
      contractConfig.initMsg,
      `${contractConfig.name}-${contractConfig.version}`,
      initFee,
      {
        admin: contractConfig.admin || deployerAddress,
      }
    );
    const contractAddress = instantiateResult.contractAddress;

    console.log(`Instantiated ${contractConfig.name} at ${contractAddress}`);

    manifest.contracts[contractConfig.name] = {
      address: contractAddress,
      wasmHash,
      version: contractConfig.version,
    };
  }

  const manifestPath = getManifestPath(network);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Deployment manifest written to ${manifestPath}`);
  client.disconnect();
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
