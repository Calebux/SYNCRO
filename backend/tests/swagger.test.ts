import { buildRouteRegistry } from '../src/routes/route-registry';
import { generateOpenApiFromRegistry } from '../src/routes/registry/openapi';

describe('registry-generated OpenAPI spec', () => {
  const registry = buildRouteRegistry();
  const spec = generateOpenApiFromRegistry(registry);

  test('has OpenAPI 3.1 version and basic info', () => {
    expect(spec).toBeDefined();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toMatch(/SYNCRO/i);
    expect(spec.info.version).toBeDefined();
  });

  test('documents authentication schemes', () => {
    const schemes = spec.components?.securitySchemes ?? {};
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

  test('covers API routes from the registry', () => {
    const paths = Object.keys(spec.paths ?? {});
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths).toEqual(expect.arrayContaining([
      '/api/user/profile',
      '/api/subscriptions',
      '/api/keys',
    ]));
  });

  test('includes security for authenticated routes', () => {
    const subPath = spec.paths?.['/api/subscriptions'];
    expect(subPath).toBeDefined();
    // At least one method should have security defined
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    const hasSecurity = methods.some(
      (m) => subPath?.[m] && 'security' in subPath[m]! && (subPath[m] as any).security,
    );
    expect(hasSecurity).toBe(true);
  });
});
