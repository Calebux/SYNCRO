const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PUBLIC_KEY_VERSION = 6 << 3;
const SECRET_SEED_VERSION = 18 << 3;

function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function encodeCheck(version: number, payload: Uint8Array): string {
  const body = new Uint8Array(1 + payload.length);
  body[0] = version;
  body.set(payload, 1);
  const checksum = crc16xmodem(body);
  const bytes = new Uint8Array(body.length + 2);
  bytes.set(body, 0);
  bytes[body.length] = checksum & 0xff;
  bytes[body.length + 1] = (checksum >> 8) & 0xff;

  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeCheck(expectedVersion: number, text: string): Uint8Array {
  const clean = text.trim();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error('That key could not be read.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const bytes = Uint8Array.from(out);
  if (bytes.length < 3 || bytes[0] !== expectedVersion) {
    throw new Error('That key could not be read.');
  }
  const payload = bytes.subarray(0, bytes.length - 2);
  const checksum = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
  if (checksum !== crc16xmodem(payload)) throw new Error('That key could not be read.');
  return payload.subarray(1);
}

export function encodePublicKey(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== 32) throw new Error('That key could not be read.');
  return encodeCheck(PUBLIC_KEY_VERSION, rawPublicKey);
}

export function encodeSecretSeed(seed: Uint8Array): string {
  if (seed.length !== 32) throw new Error('That key could not be read.');
  return encodeCheck(SECRET_SEED_VERSION, seed);
}

export function decodePublicKey(publicKey: string): Uint8Array {
  const raw = decodeCheck(PUBLIC_KEY_VERSION, publicKey);
  if (raw.length !== 32) throw new Error('That key could not be read.');
  return raw;
}

export function decodeSecretSeed(secretKey: string): Uint8Array {
  const raw = decodeCheck(SECRET_SEED_VERSION, secretKey);
  if (raw.length !== 32) throw new Error('That key could not be read.');
  return raw;
}
