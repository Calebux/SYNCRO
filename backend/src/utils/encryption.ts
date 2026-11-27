import crypto from 'crypto';
import { env } from '../config/env';

const getEncryptionKey = (): Buffer => {
  if (env.ENCRYPTION_KEY) {
    const hexKey = Buffer.from(env.ENCRYPTION_KEY, 'hex');
    if (hexKey.length === 32) {
      return hexKey;
    }
  }

  const keySource = env.ENCRYPTION_KEY || env.JWT_SECRET;
  if (!keySource) {
    throw new Error('ENCRYPTION_KEY or JWT_SECRET is required for encryption');
  }

  return crypto.createHash('sha256').update(String(keySource)).digest();
};

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Encrypts a string using AES-256-GCM.
 * @param text The plain text to encrypt.
 * @returns The encrypted string in the format: iv:tag:encryptedText
 */
export function encrypt(text: string): string {
  if (!text) return text;

  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a string encrypted with AES-256-GCM.
 * @param encryptedText The encrypted text in the format: iv:tag:encryptedText.
 * @returns The decrypted plain text.
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText || !encryptedText.includes(':')) {
    return encryptedText;
  }

  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;

    const [ivHex, tagHex, encryptedDataHex] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const key = getEncryptionKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch {
    return encryptedText;
  }
}

/**
 * Encrypts a string using AES-256-GCM with a user-derived key.
 * @param text The plain text to encrypt.
 * @param userId The ID of the user whose derived key should be used.
 * @returns The encrypted string in the format: iv:tag:encryptedText
 */
export function encryptForUser(text: string, userId: string): string {
  if (!text) return text;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  // Import dynamically/lazily to avoid potential circular dependency issues
  const { privacyService } = require('../services/privacy-service');
  const key = privacyService.getUserDerivedKey(userId);
  
  const cipher = crypto.createCipheriv(ALGORITHM, iv, key);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a string using AES-256-GCM with a user-derived key.
 * @param encryptedText The encrypted text in the format: iv:tag:encryptedText.
 * @param userId The ID of the user whose derived key should be used.
 * @returns The decrypted plain text.
 */
export function decryptForUser(encryptedText: string, userId: string): string {
  if (!encryptedText || !encryptedText.includes(':')) {
    return encryptedText;
  }
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText;
  
  const [ivHex, tagHex, encryptedDataHex] = parts;
  
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  
  // Import dynamically/lazily to avoid potential circular dependency issues
  const { privacyService } = require('../services/privacy-service');
  const key = privacyService.getUserDerivedKey(userId);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, iv, key);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

