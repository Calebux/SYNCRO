export interface StealthMetaAddress {
  version: 'syncro:stealth:v1';
  spendingPubkey: string;
  viewingPubkey: string;
  encoded: string;
}

const VERSION_PREFIX = 'syncro:stealth:v1';

export function encodeStealthMetaAddress(params: {
  spendingPubkey: string;
  viewingPubkey: string;
}): string {
  return `${VERSION_PREFIX}:${params.spendingPubkey}:${params.viewingPubkey}`;
}

export function decodeStealthMetaAddress(value: string): StealthMetaAddress | null {
  if (!value.startsWith(`${VERSION_PREFIX}:`)) return null;
  const payload = value.slice(VERSION_PREFIX.length + 1);
  const parts = payload.split(':');
  if (parts.length !== 2) return null;
  const [spendingPubkey, viewingPubkey] = parts;
  if (!spendingPubkey || !viewingPubkey) {
    return null;
  }
  return {
    version: 'syncro:stealth:v1',
    spendingPubkey,
    viewingPubkey,
    encoded: value,
  };
}

export function isValidStealthMetaAddress(value: string | null | undefined): boolean {
  return value != null && decodeStealthMetaAddress(value) !== null;
}

export function generateStealthMetaAddress(): StealthMetaAddress {
  const spendingPubkey = randomHex(64);
  const viewingPubkey = randomHex(64);
  return {
    version: 'syncro:stealth:v1',
    spendingPubkey,
    viewingPubkey,
    encoded: encodeStealthMetaAddress({ spendingPubkey, viewingPubkey }),
  };
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
