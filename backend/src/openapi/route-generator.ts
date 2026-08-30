/**
 * Scans Express route files and index.ts to emit OpenAPI path JSDoc blocks
 * from route comment annotations and router method registrations.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface RouteDefinition {
  method: string;
  path: string;
  summary: string;
  tag: string;
  security: 'public' | 'user' | 'admin';
  x402?: boolean;
}

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const INDEX_FILE = path.join(__dirname, '..', 'index.ts');

const TAG_BY_PREFIX: Record<string, string> = {
  '/api/subscriptions': 'Subscriptions',
  '/api/analytics': 'Analytics',
  '/api/tags': 'Tags',
  '/api/user': 'User',
  '/api/user-preferences': 'User Preferences',
  '/api/mfa': 'MFA',
  '/api/keys': 'API Keys',
  '/api/team': 'Team',
  '/api/digest': 'Digest',
  '/api/notifications/push': 'Push Notifications',
  '/api/risk-score': 'Risk Score',
  '/api/simulation': 'Simulation',
  '/api/exchange-rates': 'Exchange Rates',
  '/api/calendar': 'Calendar',
  '/api/gift-card-ledger': 'Gift Card Ledger',
  '/api/referrals': 'Referrals',
  '/api/suggestions': 'Suggestions',
  '/api/merchants': 'Merchants',
  '/api/audit': 'Audit',
  '/api/compliance': 'Compliance',
  '/api/webhooks': 'Webhooks',
  '/api/reminder-settings': 'Reminder Settings',
  '/api/integrations/gmail': 'Gmail Integration',
  '/api/integrations/outlook': 'Outlook Integration',
  '/api/integrations/yahoo': 'Yahoo Integration',
  '/api/integrations/icloud': 'iCloud Integration',
  '/api/integrations/slack': 'Slack Integration',
  '/api/integrations/email': 'Email Integration',
  '/api/telegram': 'Telegram',
  '/api/admin': 'Admin',
  '/api/reminders': 'Reminders',
  '/api/payments': 'Payments',
  '/api/payment-channels': 'Payment Channels',
  '/api/wallet': 'Wallet',
  '/api/key-rotation': 'Key Rotation',
  '/api/privacy': 'Privacy',
  '/api/notifications/dead-letter': 'Notification Dead Letter',
  '/api/renewals/dead-letter': 'Renewal Dead Letter',
  '/api/csp-violations': 'CSP Violations',
  '/api/webhooks/paystack': 'Paystack Webhook',
};

const X402_PREFIXES = ['/api/payments', '/api/payment-channels', '/api/wallet'];

function tagForPath(fullPath: string): string {
  const sorted = Object.keys(TAG_BY_PREFIX).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (fullPath.startsWith(prefix)) {
      return TAG_BY_PREFIX[prefix];
    }
  }
  if (fullPath.startsWith('/health')) return 'Health';
  return 'API';
}

function isX402Path(fullPath: string): boolean {
  return X402_PREFIXES.some((prefix) => fullPath.startsWith(prefix));
}

function normalizePath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function joinPaths(mount: string, routePath: string): string {
  if (routePath === '/') return mount;
  const base = mount.endsWith('/') ? mount.slice(0, -1) : mount;
  const suffix = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base}${suffix}`;
}

function parseMountPoints(indexSource: string): Map<string, { mount: string; auth: 'public' | 'user' | 'admin' }> {
  const mounts = new Map<string, { mount: string; auth: 'public' | 'user' | 'admin' }>();
  const importRegex = /import\s+(?:(\w+)|\{([^}]+)\})\s+from\s+['"]\.\/routes\/([^'"]+)['"]/g;
  const importMap = new Map<string, string>();

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(indexSource)) !== null) {
    const defaultImport = match[1];
    const namedImports = match[2];
    const filePath = match[3];
    if (defaultImport) {
      importMap.set(defaultImport, filePath);
    }
    if (namedImports) {
      for (const part of namedImports.split(',')) {
        const trimmed = part.trim();
        const aliasMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
        if (aliasMatch) {
          importMap.set(aliasMatch[2], filePath);
        } else {
          importMap.set(trimmed.replace(/\s/g, ''), filePath);
        }
      }
    }
  }

  const useLineRegex = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*([\s\S]*?)\s*\)\s*;?/g;
  while ((match = useLineRegex.exec(indexSource)) !== null) {
    const mount = match[1];
    if (!mount.startsWith('/api/')) continue;

    const args = match[2];
    const routerMatch = args.match(/(\w+Routes|\w+Router)\s*\)?\s*$/);
    if (!routerMatch) continue;

    const routerVar = routerMatch[1];
    const filePath = importMap.get(routerVar);
    if (!filePath) continue;

    let auth: 'public' | 'user' | 'admin' = 'public';
    if (args.includes('adminAuth') || mount.includes('/admin/')) auth = 'admin';
    else if (args.includes('authenticate')) auth = 'user';

    mounts.set(filePath.replace(/\.ts$/, ''), { mount, auth });
  }

  return mounts;
}

function parseCommentRoutes(source: string): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const commentRegex = /\/\*\*\s*\n(?: \*[^\n]*\n)*? \*\//g;
  const methodLineRegex = /^\s*\*\s*(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/m;
  const descLineRegex = /^\s*\*\s*(?!@|GET |POST |PUT |PATCH |DELETE )(.+)/m;

  let block: RegExpExecArray | null;
  while ((block = commentRegex.exec(source)) !== null) {
    const text = block[0];
    if (text.includes('@swagger') || text.includes('@openapi')) continue;
    if (text.includes('Routes:') || text.includes('Issue #')) continue;

    const methodMatch = methodLineRegex.exec(text);
    if (!methodMatch) continue;

    const method = methodMatch[1].toLowerCase();
    const routePath = methodMatch[2];
    const descMatch = descLineRegex.exec(text.slice(methodMatch.index + methodMatch[0].length));
    const summary = descMatch ? descMatch[1].trim() : `${method.toUpperCase()} ${routePath}`;

    routes.push({
      method,
      path: normalizePath(routePath),
      summary,
      tag: tagForPath(routePath),
      security: routePath.startsWith('/api/admin') ? 'admin' : 'user',
      x402: isX402Path(routePath),
    });
  }

  return routes;
}

function parseRouterMethods(
  source: string,
  mount: string,
  defaultAuth: 'public' | 'user' | 'admin',
): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const routerRegex = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = routerRegex.exec(source)) !== null) {
    const method = match[1].toLowerCase();
    const routePath = match[2];
    const fullPath = normalizePath(joinPaths(mount, routePath));

    routes.push({
      method,
      path: fullPath,
      summary: `${method.toUpperCase()} ${fullPath}`,
      tag: tagForPath(fullPath),
      security: source.includes('router.use(adminAuth)') || fullPath.includes('/admin/')
        ? 'admin'
        : source.includes('router.use(authenticate)') || defaultAuth === 'user'
          ? 'user'
          : defaultAuth,
      x402: isX402Path(fullPath),
    });
  }

  return routes;
}

function parseInlineIndexRoutes(indexSource: string): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const inlineRegex = /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(indexSource)) !== null) {
    const method = match[1].toLowerCase();
    const routePath = match[2];
    if (routePath.startsWith('/api/docs') || routePath.startsWith('/api-docs')) continue;

    const segment = indexSource.slice(match.index, match.index + 400);
    let security: RouteDefinition['security'] = 'public';
    if (segment.includes('adminAuth')) security = 'admin';
    else if (segment.includes('authenticate')) security = 'user';

    routes.push({
      method,
      path: normalizePath(routePath),
      summary: `${method.toUpperCase()} ${routePath}`,
      tag: tagForPath(routePath),
      security,
      x402: isX402Path(routePath),
    });
  }

  return routes;
}

function dedupeRoutes(routes: RouteDefinition[]): RouteDefinition[] {
  const byKey = new Map<string, RouteDefinition>();

  for (const route of routes) {
    const key = `${route.method}:${route.path}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, route);
      continue;
    }

    const existingIsGeneric = existing.summary.startsWith(existing.method.toUpperCase());
    const incomingIsGeneric = route.summary.startsWith(route.method.toUpperCase());
    if (existingIsGeneric && !incomingIsGeneric) {
      byKey.set(key, route);
    }
  }

  return [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function collectRouteFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(full, files);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

export function collectRouteDefinitions(): RouteDefinition[] {
  const indexSource = fs.readFileSync(INDEX_FILE, 'utf8');
  const mounts = parseMountPoints(indexSource);
  const routes: RouteDefinition[] = [...parseInlineIndexRoutes(indexSource)];

  for (const filePath of collectRouteFiles(ROUTES_DIR)) {
    const rel = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/').replace(/\.ts$/, '');
    const relKey = rel.replace(/^routes\//, '');
    const source = fs.readFileSync(filePath, 'utf8');

    routes.push(...parseCommentRoutes(source));

    const mountInfo = mounts.get(relKey);
    if (mountInfo) {
      routes.push(...parseRouterMethods(source, mountInfo.mount, mountInfo.auth));
    }
  }

  return dedupeRoutes(routes);
}

function sanitizeSummary(summary: string): string {
  const cleaned = summary
    .replace(/\s+/g, ' ')
    .replace(/"/g, '\\"')
    .trim();
  if (/[:#{}[\]|>&*!?@`]/.test(cleaned) || cleaned.startsWith('-')) {
    return `"${cleaned}"`;
  }
  return cleaned;
}

function securityBlock(security: RouteDefinition['security']): string {
  if (security === 'admin') {
    return ` *     security:
 *       - adminKey: []`;
  }
  if (security === 'user') {
    return ` *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *       - cookieAuth: []`;
  }
  return '';
}

function x402Parameters(route: RouteDefinition): string {
  if (!route.x402) return '';
  if (route.method === 'post' || route.method === 'put' || route.method === 'patch') {
    return ` *     parameters:
 *       - $ref: '#/components/parameters/PaymentSignatureHeader'
`;
  }
  return '';
}

function x402Responses(route: RouteDefinition): string {
  if (!route.x402) return '';
  return ` *       402:
 *         description: Payment required (x402)
 *         headers:
 *           PAYMENT-REQUIRED:
 *             $ref: '#/components/headers/PaymentRequired'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/X402PaymentRequired'
 *             example:
 *               x402Version: 2
 *               error: "PAYMENT-SIGNATURE header is required"
 *               accepts:
 *                 - scheme: exact
 *                   network: "eip155:84532"
 *                   amount: "10000"
 *                   asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
 *                   payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"
 *                   maxTimeoutSeconds: 60
`;
}

export function renderOpenApiPaths(routes: RouteDefinition[]): string {
  const blocks = routes.map((route) => {
    const security = securityBlock(route.security);
    const x402Params = x402Parameters(route);
    const x402Resp = x402Responses(route);
    const x402Ext = route.x402
      ? ` *     x-x402-payment:
 *       enabled: true
 *       description: Supports HTTP 402 micropayments via PAYMENT-SIGNATURE header
`
      : '';

    return `/**
 * @openapi
 * ${route.path}:
 *   ${route.method}:
 *     summary: ${sanitizeSummary(route.summary)}
 *     tags: [${route.tag}]
${x402Ext}${security}
${x402Params} *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data: {}
${x402Resp} *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */`;
  });

  return `/**
 * AUTO-GENERATED FILE — do not edit manually.
 * Regenerate with: npm run openapi:generate
 *
 * OpenAPI path definitions generated from route comments and router registrations.
 */
${blocks.join('\n\n')}
`;
}

export function generateOpenApiPathsFile(outputPath: string): number {
  const routes = collectRouteDefinitions();
  fs.writeFileSync(outputPath, renderOpenApiPaths(routes));
  return routes.length;
}
