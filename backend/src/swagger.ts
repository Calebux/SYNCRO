import swaggerJSDoc from 'swagger-jsdoc';
import type { OpenAPIV3_1 } from 'openapi-types';
import authoredContract from './openapi/openapi.json';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'SYNCRO API',
      version: '2.0.0',
      description: [
        'Self-custodial subscription management platform API.',
        '',
        '## Versioning',
        '',
        '- **v2** (`/api/v2`) — current contract: success envelope, RFC 7807 errors, opaque cursor pagination. See docs/api/v2-envelope.md.',
        '- **v1** (`/api/*` and `/api/v1`) — frozen. Deprecated 2026-08-26; sunset 2027-02-26.',
        '',
        '## Authentication',
        '',
        'Most endpoints require one of:',
        '- **Bearer token** — `Authorization: Bearer <supabase_jwt>`',
        '- **API key** — `x-api-key: sk_...` (created via `/api/keys`)',
        '- **Session cookie** — `authToken` HTTP-only cookie',
        '',
        'Admin endpoints require `X-Admin-API-Key`.',
        '',
        '## x402 Micropayments',
        '',
        'Payment endpoints support the [x402 protocol](https://docs.x402.org/) via HTTP 402 and',
        'the `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` headers.',
      ].join('\n'),
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development server' },
      { url: 'https://api.syncro.app', description: 'Production server' },
    ],
    tags: [
      { name: 'Health', description: 'Liveness and readiness probes' },
      { name: 'Analytics', description: 'Spend analytics and forecasting' },
      { name: 'API Keys', description: 'Programmatic API key management' },
      { name: 'Payments', description: 'Wallet funding and payment channels (x402-capable)' },
      { name: 'Admin', description: 'Admin-only monitoring and operations' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase JWT token via Authorization: Bearer <token>',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API key prefixed with sk_ (POST /api/keys to create)',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'authToken',
          description: 'HTTP-only cookie auth (alternative to Bearer)',
        },
        adminKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Admin-API-Key',
          description: 'Admin API key for protected admin endpoints',
        },
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', examples: [true] },
            data: { type: 'object' },
          },
        },
        ProblemDetails: {
          type: 'object',
          properties: {
            type: { type: 'string', format: 'uri', examples: ['https://syncro.app/errors/not-found'] },
            title: { type: 'string', examples: ['Not Found'] },
            status: { type: 'integer', examples: [404] },
            detail: { type: 'string', examples: ['Subscription with ID 123 not found.'] },
            instance: { type: 'string', examples: ['/api/subscriptions/123'] },
            requestId: { type: 'string', examples: ['req-abc-123'] },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        ErrorResponse: {
          $ref: '#/components/schemas/ProblemDetails',
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', examples: [42] },
            limit: { type: 'integer', examples: [20] },
            offset: { type: 'integer', examples: [0] },
            hasMore: { type: 'boolean', examples: [false] },
            nextCursor: { type: 'string', nullable: true, examples: [null] },
          },
        },
        CreateApiKeyRequest: {
          type: 'object',
          required: ['scopes'],
          properties: {
            name: { type: 'string', examples: ['CI integration'] },
            scopes: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['subscriptions:read', 'subscriptions:write', 'webhooks:write', 'analytics:read'],
              },
              examples: [['subscriptions:read', 'subscriptions:write']],
            },
          },
        },
        ApiKeyResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', examples: ['CI integration'] },
            key: { type: 'string', examples: ['sk_live_a1b2c3d4e5f67890'] },
            scopes: { type: 'array', items: { type: 'string' } },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        BlockchainResult: {
          type: 'object',
          properties: {
            synced: { type: 'boolean' },
            transactionHash: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
          },
        },
        RiskScore: {
          type: 'object',
          properties: {
            subscription_id: { type: 'string', format: 'uuid' },
            risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            risk_factors: { type: 'array', items: { type: 'object' } },
            last_calculated_at: { type: 'string', format: 'date-time' },
          },
        },
        TeamMember: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email', nullable: true },
            role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
            joinedAt: { type: 'string', format: 'date-time' },
          },
        },
        MonthlySpend: {
          type: 'object',
          properties: {
            month: { type: 'string', examples: ['2026-05'], description: 'YYYY-MM' },
            total_spend: { type: 'number', examples: [89.97] },
            count: { type: 'integer', examples: [5] },
          },
        },
        CategorySpend: {
          type: 'object',
          properties: {
            category: { type: 'string', examples: ['Entertainment'] },
            total_spend: { type: 'number', examples: [45.98] },
            percentage: { type: 'number', examples: [51.1] },
            count: { type: 'integer', examples: [3] },
          },
        },
        SubscriptionSpend: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', examples: ['Netflix'] },
            price: { type: 'number', examples: [15.99] },
            billing_cycle: { type: 'string', examples: ['monthly'] },
            monthly_normalized_price: { type: 'number', examples: [15.99] },
          },
        },
      },
    },
  },
  apis: [
    './src/openapi/generated-paths.ts',
    './src/openapi/x402-docs.ts',
    './src/openapi/v2-envelope.ts',
    './src/routes/**/*.ts',
    './src/index.ts',
  ],
};

const document = swaggerJSDoc(options) as unknown as OpenAPIV3_1.Document;
document.paths = { ...document.paths, ...authoredContract.paths } as unknown as OpenAPIV3_1.PathsObject;

// Pin authorization failures to the shared problem-details contract.
for (const item of Object.values(document.paths ?? {})) {
  for (const [method, value] of Object.entries(item ?? {})) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || !value || typeof value !== 'object') continue;
    const operation = value as OpenAPIV3_1.OperationObject;
    operation.responses ??= {};
    if (!operation.responses['200'] && !operation.responses['201'] && !operation.responses['204']) {
      operation.responses['200'] = { description: 'Successful response' };
    }
    const secured = 'security' in operation && Array.isArray(operation.security) && operation.security.length > 0;
    if (secured && !operation.responses['401']) operation.responses['401'] = {
      description: 'Unauthorized',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } as OpenAPIV3_1.ReferenceObject } },
    };
  }
}

export const swaggerSpec = document;
