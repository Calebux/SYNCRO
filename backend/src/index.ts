import * as bip39 from 'bip39';

/**
 * Generates a standard BIP39 12-word mnemonic phrase.
 */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

/**
 * Validates a 12-word BIP39 mnemonic phrase.
 */
export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic || typeof mnemonic !== 'string') {
    return false;
  }

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 12) {
    return false;
  }

  return bip39.validateMnemonic(words.join(' '));
}