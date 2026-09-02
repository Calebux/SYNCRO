export interface CryptoPrimitives {
  randomBytes(length: number): Uint8Array;
  sha256(data: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
