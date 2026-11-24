export class CryptoUnavailableError extends Error {
  readonly code = 'CRYPTO_UNAVAILABLE';
  readonly primitive: string;

  constructor(primitive: string, detail?: string) {
    super(
      detail ||
        `Required crypto primitive "${primitive}" is unavailable in this runtime. Refusing to fall back to a weaker path.`,
    );
    this.name = 'CryptoUnavailableError';
    this.primitive = primitive;
  }
}
