export interface RoutePricingRule {
  price: number;
  currency?: string;
  description?: string;
  /** Unit the price is expressed in (e.g. "request", "1k_tokens"). */
  unit?: string;
  /** Asset the price is denominated in (e.g. "USDC"). Defaults to the declaration currency. */
  asset?: string;
}

export type PricingDeclarationInput = 
  | number 
  | RoutePricingRule
  | Record<string, number | RoutePricingRule>;

export interface PricingDeclaration {
  defaultPrice?: number;
  currency?: string;
  /** Version identifier of this rate card, echoed back in gateway quotes. */
  version?: string;
  routes: Record<string, RoutePricingRule>;
}

export interface RoutePricing {
  defaultPrice: number;
  currency: string;
  /** Version identifier of the rate card backing this pricing declaration. */
  version: string;
  /** Default unit applied to routes that do not declare one. */
  unit: string;
  /** Default asset applied to routes that do not declare one. */
  asset: string;
  match(method: string, path: string): RoutePricingRule;
}

export function pricing(input: PricingDeclarationInput | Record<string, any>): RoutePricing {
  let defaultPrice = 0.01;
  let defaultCurrency = 'USDC';
  let version = 'v1';
  let defaultUnit = 'request';
  let defaultAsset = defaultCurrency;
  const routes: Record<string, RoutePricingRule> = {};

  if (typeof input === 'number') {
    defaultPrice = input;
  } else if (typeof input === 'object' && input !== null) {
    if ('defaultPrice' in input && typeof (input as Record<string, any>).defaultPrice === 'number') {
      defaultPrice = (input as Record<string, any>).defaultPrice;
    }
    if ('currency' in input && typeof (input as Record<string, any>).currency === 'string') {
      defaultCurrency = (input as Record<string, any>).currency;
    }
    if ('version' in input && typeof (input as Record<string, any>).version === 'string') {
      version = (input as Record<string, any>).version;
    }
    if ('unit' in input && typeof (input as Record<string, any>).unit === 'string') {
      defaultUnit = (input as Record<string, any>).unit;
    }
    if ('asset' in input && typeof (input as Record<string, any>).asset === 'string') {
      defaultAsset = (input as Record<string, any>).asset;
    } else {
      defaultAsset = defaultCurrency;
    }
    const rawRoutes = ('routes' in input && typeof (input as Record<string, any>).routes === 'object' && (input as Record<string, any>).routes !== null)
      ? (input as Record<string, any>).routes
      : input;

    for (const [key, val] of Object.entries(rawRoutes)) {
      if (key === 'defaultPrice' || key === 'currency' || key === 'version' || key === 'unit' || key === 'asset') continue;
      const upperKey = key.trim().toUpperCase();
      if (typeof val === 'number') {
        routes[upperKey] = { price: val, currency: defaultCurrency, unit: defaultUnit, asset: defaultAsset };
      } else if (typeof val === 'object' && val !== null && typeof val === 'object' && 'price' in val) {
        const ruleCurrency = (typeof (val as Record<string, any>).currency === 'string' ? (val as Record<string, any>).currency : defaultCurrency);
        routes[upperKey] = {
          price: Number((val as Record<string, any>).price),
          currency: ruleCurrency,
          description: (typeof (val as Record<string, any>).description === 'string' ? (val as Record<string, any>).description : undefined),
          unit: (typeof (val as Record<string, any>).unit === 'string' ? (val as Record<string, any>).unit : defaultUnit),
          asset: (typeof (val as Record<string, any>).asset === 'string' ? (val as Record<string, any>).asset : (ruleCurrency || defaultAsset)),
        };
      }
    }
  }

  return {
    defaultPrice,
    currency: defaultCurrency,
    version,
    unit: defaultUnit,
    asset: defaultAsset,
    match(method: string, path: string): RoutePricingRule {
      const upperMethod = method.toUpperCase();
      const exactKey1 = `${upperMethod} ${path}`;
      const exactKey2 = path;
      const wildcardKey = `${upperMethod} *`;

      const match1 = routes[exactKey1];
      if (match1) return match1;

      const match2 = routes[exactKey2];
      if (match2) return match2;

      const match3 = routes[wildcardKey];
      if (match3) return match3;

      for (const [pattern, rule] of Object.entries(routes)) {
        if (pattern.includes(' ')) {
          const parts = pattern.split(' ');
          const patMethod = parts[0];
          const patPath = parts[1];
          if (patMethod && patMethod !== '*' && patMethod !== upperMethod) continue;
          if (patPath && matchPath(patPath, path)) {
            return rule;
          }
        } else {
          if (matchPath(pattern, path)) {
            return rule;
          }
        }
      }

      return { price: defaultPrice, currency: defaultCurrency, unit: defaultUnit, asset: defaultAsset };
    }
  };
}

function matchPath(pattern: string, path: string): boolean {
  if (pattern === '*' || pattern === '/*') return true;
  if (pattern === path) return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    if (path.startsWith(prefix)) return true;
  }
  return false;
}
