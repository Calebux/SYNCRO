import { swaggerSpec } from '../src/swagger';

describe('swagger spec', () => {
  test('has OpenAPI 3.1 version and basic info', () => {
    expect(swaggerSpec).toBeDefined();
    expect(swaggerSpec.openapi).toBe('3.1.0');
    expect(swaggerSpec.info).toBeDefined();
    expect(swaggerSpec.info.title).toMatch(/SYNCRO/i);
    expect(swaggerSpec.info.version).toBeDefined();
  });

  test('documents authentication schemes', () => {
    const schemes = swaggerSpec.components?.securitySchemes ?? {};
    expect(schemes).toHaveProperty('bearerAuth');
    expect(schemes).toHaveProperty('apiKeyAuth');
    expect(schemes).toHaveProperty('cookieAuth');
    expect(schemes).toHaveProperty('adminKey');
    expect(schemes.apiKeyAuth).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'x-api-key',
    });
  });

  test('documents x402 payment headers', () => {
    expect(swaggerSpec.components?.parameters?.PaymentSignatureHeader).toBeDefined();
    expect(swaggerSpec.components?.headers?.PaymentRequired).toBeDefined();
    expect(swaggerSpec.components?.schemas?.X402PaymentRequired).toBeDefined();
  });

  test('covers API routes comprehensively', () => {
    const paths = Object.keys(swaggerSpec.paths ?? {});
    expect(paths.length).toBeGreaterThanOrEqual(150);
    expect(paths).toEqual(expect.arrayContaining([
      '/api/subscriptions',
      '/api/keys',
      '/api/payments/paystack/initialize',
      '/health',
    ]));
  });

  test('includes request schema examples', () => {
    expect(swaggerSpec.components?.schemas?.CreateSubscriptionRequest).toBeDefined();
    expect(swaggerSpec.components?.schemas?.CreateApiKeyRequest).toBeDefined();
  });
});
