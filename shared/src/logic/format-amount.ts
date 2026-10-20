export interface AmountAsset {
  symbol: string;
  decimals: number;
}

export type BaseUnits = bigint | number | string;

function toBaseUnitInteger(baseUnits: BaseUnits): bigint {
  if (typeof baseUnits === 'bigint') return baseUnits;
  if (typeof baseUnits === 'number') {
    if (!Number.isSafeInteger(baseUnits)) {
      throw new RangeError('Numeric base units must be safe integers; use bigint or a string for large values.');
    }
    return BigInt(baseUnits);
  }
  if (!/^-?\d+$/.test(baseUnits)) {
    throw new RangeError(`Invalid base unit amount: ${baseUnits}`);
  }
  return BigInt(baseUnits);
}

function validateDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) {
    throw new RangeError('Asset decimals must be an integer between 0 and 100.');
  }
}

export function toDecimalAmount(baseUnits: BaseUnits, asset: AmountAsset): number {
  validateDecimals(asset.decimals);
  const value = toBaseUnitInteger(baseUnits);
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(asset.decimals + 1, '0');
  const decimalValue = asset.decimals === 0
    ? digits
    : `${digits.slice(0, -asset.decimals)}.${digits.slice(-asset.decimals)}`;
  return Number(`${negative ? '-' : ''}${decimalValue}`);
}

export function formatAmount(
  baseUnits: BaseUnits,
  asset: AmountAsset,
  options: { locale?: string; showSymbol?: boolean } = {},
): string {
  validateDecimals(asset.decimals);
  const { locale, showSymbol = true } = options;
  const value = toBaseUnitInteger(baseUnits);
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(asset.decimals + 1, '0');
  const integerPart = asset.decimals === 0 ? digits : digits.slice(0, -asset.decimals);
  const fractionPart = asset.decimals === 0 ? '' : digits.slice(-asset.decimals);
  const formattedInteger = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(BigInt(integerPart));
  const negativeSign = negative
    ? new Intl.NumberFormat(locale).formatToParts(-1).find((part) => part.type === 'minusSign')?.value ?? '-'
    : '';
  const decimalSeparator = asset.decimals > 0
    ? new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.'
    : '';
  const localizedFraction = asset.decimals > 0
    ? [...fractionPart].map((digit) => new Intl.NumberFormat(locale, { useGrouping: false }).format(Number(digit))).join('')
    : '';
  const amount = `${negativeSign}${formattedInteger}${decimalSeparator}${localizedFraction}`;
  return showSymbol ? `${amount} ${asset.symbol}` : amount;
}
