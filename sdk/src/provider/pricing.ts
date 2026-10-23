export interface RoutePricingRule {
  price: number;
  currency?: string;
  description?: string;
}

export type PricingDeclarationInput = 
  | number 
  | RoutePricingRule
  | Record<string, number | RoutePricingRule>;

export interface PricingDeclaration {
  defaultPrice?: number;
  currency?: string;
  routes: Record<string, RoutePricingRule>;
}

export interface RoutePricing {
  defaultPrice: number;
  currency: string;
  match(method: string, path: string): RoutePricingRule;
}

export function pricing(input: PricingDeclarationInput | Record<string, any>): RoutePricing {
  let defaultPrice = 0.01;
  let defaultCurrency = 'USDC';
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
    const rawRoutes = ('routes' in input && typeof (input as Record<string, any>).routes === 'object' && (input as Record<string, any>).routes !== null)
      ? (input as Record<string, any>).routes
      : input;

    for (const [key, val] of Object.entries(rawRoutes)) {
      if (key === 'defaultPrice' || key === 'currency') continue;
      const upperKey = key.trim().toUpperCase();
      if (typeof val === 'number') {
        routes[upperKey] = { price: val, currency: defaultCurrency };
      } else if (typeof val === 'object' && val !== null && typeof val === 'object' && 'price' in val) {
        routes[upperKey] = {
          price: Number((val as Record<string, any>).price),
          currency: (typeof (val as Record<string, any>).currency === 'string' ? (val as Record<string, any>).currency : defaultCurrency),
          description: (typeof (val as Record<string, any>).description === 'string' ? (val as Record<string, any>).description : undefined),
        };
      }
    }
  }

  return {
    defaultPrice,
    currency: defaultCurrency,
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

      return { price: defaultPrice, currency: defaultCurrency };
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
