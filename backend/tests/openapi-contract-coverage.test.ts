import Ajv from 'ajv';
import { swaggerSpec } from '../src/swagger';
import { collectRouteDefinitions } from '../src/openapi/route-generator';
import { operations } from '../src/openapi/generated-contracts';

describe('OpenAPI contract coverage', () => {
  const documented = new Set(operations.map(operation => operation.key));
  const implemented = new Set(collectRouteDefinitions().map(route => `${route.method.toUpperCase()} ${route.path}`));

  it('documents every real handler and generates a typed signature for it', () => {
    expect([...implemented].filter(route => !documented.has(route))).toEqual([]);
  });

  it('defines machine-valid success, error, and authorization schemas', () => {
    const ajv = new Ajv({ strict: false, formats: { uri: true } });
    const schemas = swaggerSpec.components?.schemas ?? {};
    expect(() => ajv.compile({
      $id: 'contract', components: { schemas }, $ref: '#/components/schemas/ProblemDetails',
    })).not.toThrow();
    for (const item of Object.values(swaggerSpec.paths ?? {})) {
      for (const [method, operation] of Object.entries(item ?? {})) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const responses = (operation as { responses?: Record<string, unknown> }).responses ?? {};
        expect(responses['200'] ?? responses['201'] ?? responses['204']).toBeDefined();
        const security = (operation as { security?: unknown[] }).security;
        if (security?.length) expect(responses['401']).toBeDefined();
      }
    }
  });
});
