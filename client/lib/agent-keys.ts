import { publicKeyFromSeed } from './ed25519-public';
import { decodePublicKey, decodeSecretSeed, encodePublicKey, encodeSecretSeed } from './stellar-strkey';

const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export interface LocalKeypair {
  publicKey: string;
  secretKey: string;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function generateKeypair(): Promise<LocalKeypair> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' } as Algorithm, true, ['sign', 'verify']) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const seed = pkcs8.slice(pkcs8.length - 32);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: encodePublicKey(rawPublic),
    secretKey: encodeSecretSeed(seed),
  };
}

export async function identifyKey(value: string): Promise<{ publicKey: string; secretKey: string | null }> {
  const trimmed = value.trim();
  if (trimmed.startsWith('S')) {
    const seed = decodeSecretSeed(trimmed);
    return {
      publicKey: encodePublicKey(await publicKeyFromSeed(seed)),
      secretKey: trimmed,
    };
  }
  if (trimmed.startsWith('G')) {
    return { publicKey: encodePublicKey(decodePublicKey(trimmed)), secretKey: null };
  }
  throw new Error('Paste a Stellar key. Public keys start with G. Secret keys start with S.');
}

export async function signMessage(secretKey: string, message: string): Promise<string> {
  const seed = decodeSecretSeed(secretKey.trim());
  const key = await crypto.subtle.importKey(
    'pkcs8',
    concat(PKCS8_PREFIX, seed) as BufferSource,
    { name: 'Ed25519' } as Algorithm,
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' } as Algorithm,
    key,
    new TextEncoder().encode(message),
  );
  return bytesToBase64(new Uint8Array(signature));
}

/**
 * Authorisation granted by a channel principal to an agent sub-key.
 *
 * The principal (the channel payer) registers the agent key in the
 * `agent-registry` contract, scoping it to a channel and bounding its
 * lifetime. The contract resolves the state signer against this record to
 * verify the signature, the scope and the expiry (#1656).
 */
export interface AgentAuthorisation {
  /** Principal (channel payer) public key that granted the authorisation. */
  principal: string;
  /** Agent sub-key public key authorised to sign channel states. */
  agent: string;
  /** Channel the agent key may sign states for. */
  channel: string;
  /** Ledger timestamp (seconds) after which the key is no longer valid. */
  expiresAt: number;
  /** Registry entry reference the contract uses to resolve the signer. */
  registryRef: string;
}

export interface AgentKeypair extends LocalKeypair {
  /** Public key of the principal that authorised this agent key. */
  principal: string;
}

/**
 * Derive a disposable agent keypair bound to a principal.
 *
 * The returned keypair is short-lived by convention: the principal registers
 * the public key in `agent-registry` with a scope and expiry, and can revoke
 * it at any time without closing the channel.
 */
export async function deriveAgentKeypair(principal: string): Promise<AgentKeypair> {
  const pair = await generateKeypair();
  return { ...pair, principal };
}

export interface AgentStatePayload {
  channel: string;
  /** Opaque, contract-defined state body (balances, nonce, ...). */
  state: string;
}

export interface SignedAgentState {
  /** The state payload that was signed. */
  payload: AgentStatePayload;
  /** Agent sub-key public key that produced the signature. */
  signer: string;
  /** Principal authorisation reference resolved by the contract. */
  authorisation: AgentAuthorisation;
  /** Base64 Ed25519 signature over the canonical payload. */
  signature: string;
}

function canonicalAgentStatePayload(payload: AgentStatePayload): string {
  return JSON.stringify({ channel: payload.channel, state: payload.state });
}

/**
 * Sign a channel state with an agent sub-key under principal authority.
 *
 * The signature is produced by the agent key, and the principal authorisation
 * reference is attached so the contract can resolve the signer against the
 * registry's current key, scope and expiry. Signing is refused when the
 * authorisation is expired, scoped to a different channel, or does not match
 * the agent key.
 */
export async function signChannelStateWithAgent(
  agentKeypair: AgentKeypair,
  authorisation: AgentAuthorisation,
  payload: AgentStatePayload,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SignedAgentState> {
  if (authorisation.agent !== agentKeypair.publicKey) {
    throw new Error('Authorisation does not match the agent key.');
  }
  if (authorisation.principal !== agentKeypair.principal) {
    throw new Error('Authorisation was not granted by this agent key\'s principal.');
  }
  if (authorisation.channel !== payload.channel) {
    throw new Error('Agent key is not authorised for this channel.');
  }
  if (nowSeconds >= authorisation.expiresAt) {
    throw new Error('Agent key authorisation has expired.');
  }
  const signature = await signMessage(agentKeypair.secretKey, canonicalAgentStatePayload(payload));
  return {
    payload,
    signer: agentKeypair.publicKey,
    authorisation,
    signature,
  };
}

/**
 * Refuse to sign new states once the agent key has been revoked.
 *
 * Earlier states remain valid: the contract validates each state against the
 * registry record that was current when the state was signed, so revocation
 * only blocks new signatures.
 */
export function assertAgentKeyActive(
  authorisation: AgentAuthorisation,
  revokedRegistryRefs: ReadonlySet<string>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  if (revokedRegistryRefs.has(authorisation.registryRef)) {
    throw new Error('Agent key has been revoked; refusing to sign new states.');
  }
  if (nowSeconds >= authorisation.expiresAt) {
    throw new Error('Agent key authorisation has expired.');
  }
}

/**
 * Sign a channel state with an agent sub-key, refusing if the key is revoked.
 */
export async function signChannelStateWithAgentChecked(
  agentKeypair: AgentKeypair,
  authorisation: AgentAuthorisation,
  payload: AgentStatePayload,
  revokedRegistryRefs: ReadonlySet<string>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SignedAgentState> {
  assertAgentKeyActive(authorisation, revokedRegistryRefs, nowSeconds);
  return signChannelStateWithAgent(agentKeypair, authorisation, payload, nowSeconds);
}
