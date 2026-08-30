"use client"

const STORAGE_VERSION = "v1"
const SALT_KEY = "__syncro_secure_storage_salt__"
const KEY_DERIVATION_ITERATIONS = 150000
const IV_LENGTH = 12

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length")
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function getOrCreateSalt(): Uint8Array {
  const existingSalt = localStorage.getItem(SALT_KEY)
  if (existingSalt) {
    return new Uint8Array(hexToBytes(existingSalt).buffer)
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  localStorage.setItem(SALT_KEY, bytesToHex(salt))
  return salt
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${window.location.origin}:${navigator.userAgent}:syncro-secure-storage`),
    "PBKDF2",
    false,
    ["deriveKey"]
  )

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: getOrCreateSalt() as unknown as BufferSource,
      iterations: KEY_DERIVATION_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encrypt(value: unknown): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await getEncryptionKey()
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, plaintext as unknown as BufferSource)
  const ciphertext = new Uint8Array(encrypted)
  return `${STORAGE_VERSION}.${bytesToHex(iv)}.${bytesToHex(ciphertext)}`
}

export async function decrypt<T>(encryptedValue: string): Promise<T> {
  const [version, ivHex, ciphertextHex] = encryptedValue.split(".")
  if (version !== STORAGE_VERSION || !ivHex || !ciphertextHex) {
    throw new Error("Invalid encrypted value format")
  }

  const key = await getEncryptionKey()
  const iv = hexToBytes(ivHex)
  const ciphertext = hexToBytes(ciphertextHex)
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, ciphertext as unknown as BufferSource)
  const plaintext = new TextDecoder().decode(decrypted)
  return JSON.parse(plaintext) as T
}

export const secureStorage = {
  async set(key: string, value: unknown): Promise<void> {
    if (typeof window === "undefined") return
    try {
      const encrypted = await encrypt(value)
      localStorage.setItem(key, encrypted)
    } catch (error) {
      console.error("Failed to store data:", error)
    }
  },

  async get<T>(key: string): Promise<T | null> {
    if (typeof window === "undefined") return null
    try {
      const encrypted = localStorage.getItem(key)
      if (!encrypted) return null
      return await decrypt<T>(encrypted)
    } catch (error) {
      console.error("Failed to retrieve data:", error)
      return null
    }
  },

  remove(key: string): void {
    if (typeof window === "undefined") return
    localStorage.removeItem(key)
  },

  clear(): void {
    if (typeof window === "undefined") return
    localStorage.clear()
  },
}
