import type { OpenAPIV3_1 } from 'openapi-types';
import type { RouteDescriptor } from './types';
import type { RouteRegistry } from './registry';

const TAG_BY_PREFIX: Record<string, string> = {
  '/subscriptions': 'Subscriptions',
  '/analytics': 'Analytics',
  '/tags': 'Tags',
  '/user': 'User',
  '/user-preferences': 'User Preferences',
  '/mfa': 'MFA',
  '/2fa': 'MFA',
  '/keys': 'API Keys',
  '/team': 'Team',
  '/teams': 'Team',
  '/digest': 'Digest',
  '/notifications': 'Notifications',
  '/risk-score': 'Risk Score',
  '/simulation': 'Simulation',
  '/exchange-rates': 'Exchange Rates',
  '/calendar': 'Calendar',
  '/gift-card-ledger': 'Gift Card Ledger',
  '/referrals': 'Referrals',
  '/suggestions': 'Suggestions',
  '/merchants': 'Merchants',
  '/audit': 'Audit',
  '/compliance': 'Compliance',
  '/webhooks': 'Webhooks',
  '/reminder-settings': 'Reminder Settings',
  '/integrations': 'Integrations',
  '/telegram': 'Telegram',
  '/admin': 'Admin',
  '/reminders': 'Reminders',
  '/payments': 'Payments',
  '/payment-channels': 'Payment Channels',
  '/wallet': 'Wallet',
  '/key-rotation': 'Key Rotation',
  '/privacy': 'Privacy',
  '/csp-violations': 'CSP Violations',
  '/sessions': 'Sessions',
  '/metrics': 'Metrics',
  '/agent-wallets': 'Agent Wallets',
  '/webhooks/stripe': 'Webhooks',
  '/webhooks/paystack': 'Webhooks',
  '/webhooks/paypal': 'Webhooks',
};

const X402_PREFIXES = ['/payments', '/payment-channels', '/wallet'];

function tagForPath(path: string): string {
  const sorted = Object.keys(TAG_BY_PREFIX).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (path.startsWith(prefix)) {
      return TAG_BY_PREFIX[prefix];
    }
  }
  return 'API';
}

function isX402Path(path: string): boolean {
  return X402_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function normalizeParamStyle(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function securityForAuth(
  auth: RouteDescriptor['auth'],
): OpenAPIV3_1.SecurityRequirementObject[] | undefined {
  if (auth === 'admin') {
    return [{ adminKey: [] }];
  }
  if (auth === 'user') {
    return [{ bearerAuth: [] }, { apiKeyAuth: [] }, { cookieAuth: [] }];
  }
  return undefined;
}

/**
 * Generate an OpenAPI 3.1 document from the registry's route descriptors.
 * Accepts optional external descriptors for routes mounted outside the
 * registry (e.g., webhooks mounted before express.json()).
 */
export function generateOpenApiFromRegistry(
  registry: RouteRegistry,
  info: {
    title?: string;
    version?: string;
    description?: string;
  } = {},
  externalDescriptors?: RouteDescriptor[],
): OpenAPIV3_1.Document {
  const descriptors = [
    ...registry.getDescriptors(),
    ...(externalDescriptors || []),
  ];

  const paths: OpenAPIV3_1.PathsObject = {};

  for (const d of descriptors) {
    const fullPath = normalizeParamStyle(registry.getFullPath(d));
    if (!paths[fullPath]) {
      paths[fullPath] = {};
    }

    const tag = tagForPath(fullPath);
    const security = securityForAuth(d.auth);

    // For ALL method routers, document as a catch-all path item
    if (d.method === 'ALL') {
      const methods: Array<keyof OpenAPIV3_1.PathItemObject> = ['get', 'post', 'put', 'patch', 'delete'];
      for (const m of methods) {
        if (!paths[fullPath][m]) {
          paths[fullPath][m] = {
            summary: d.summary || `${m.toUpperCase()} ${fullPath}`,
            tags: [tag],
            description: d.description || 'Router-level handler',
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean', examples: [true] },
                        data: { type: 'object' },
                      },
                    },
                  },
                },
              },
              '401': {
                description: 'Unauthorized',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
              '500': {
                description: 'Internal server error',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
            },
          };
          if (security) paths[fullPath][m]!.security = security;
        }
      }
      continue;
    }

    const method = d.method.toLowerCase() as keyof OpenAPIV3_1.PathItemObject;

    const operation: OpenAPIV3_1.OperationObject = {
      summary: d.summary || `${d.method} ${fullPath}`,
      tags: [tag],
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', examples: [true] },
                  data: { type: 'object' },
                },
              },
            },
          },
        },
        '401': {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        '500': {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
    };

    if (security) operation.security = security;
    if (d.description) operation.description = d.description;
    if (d.deprecated) operation.deprecated = true;

    if (d.x402 || isX402Path(fullPath)) {
      (operation as any)['x-x402-payment'] = {
        enabled: true,
        description:
          'Supports HTTP 402 micropayments via PAYMENT-SIGNATURE header',
      };
      operation.responses!['402'] = {
        description: 'Payment required (x402)',
      };
    }

    paths[fullPath][method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: info.title || 'SYNCRO API',
      version: info.version || '2.0.0',
      description:
        info.description ||
        [
          'Self-custodial subscription management platform API.',
          '',
          '## Authentication',
          '',
          'Most endpoints require one of:',
          '- **Bearer token** — `Authorization: Bearer <supabase_jwt>`',
          '- **API key** — `x-api-key: sk_...` (created via `/api/keys`)',
          '- **Session cookie** — `authToken` HTTP-only cookie',
          '',
          'Admin endpoints require `X-Admin-API-Key`.',
        ].join('\n'),
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development server' },
      { url: 'https://api.syncro.app', description: 'Production server' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'authToken',
        },
        adminKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Admin-API-Key',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', examples: [true] },
            data: { type: 'object' },
          },
        },
      },
    },
  };
}
