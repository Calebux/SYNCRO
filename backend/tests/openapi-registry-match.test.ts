import { swaggerSpec } from '../src/swagger';
import { getMountedRoutes } from '../src/router/registry';

describe('OpenAPI Spec matches mounted routes', () => {
  test('every mounted route has an OpenAPI path entry', () => {
    const mountedRoutes = getMountedRoutes();
    const openApiPaths = Object.keys(swaggerSpec.paths ?? {});

    // Convert mounted routes to OpenAPI path format
    const expectedPaths = mountedRoutes.map(route => 
      route.fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    );

    // Check that each expected path exists in the OpenAPI spec
    for (const expectedPath of expectedPaths) {
      const matchingPath = openApiPaths.find(p => {
        // Normalize both paths for comparison
        const normalizedExpected = expectedPath.replace(/\{[^}]+\}/g, '*');
        const normalizedActual = p.replace(/\{[^}]+\}/g, '*');
        return normalizedExpected === normalizedActual;
      });
      
      expect(matchingPath).toBeDefined();
    }
  });

  test('every mounted route has correct HTTP method in OpenAPI spec', () => {
    const mountedRoutes = getMountedRoutes();
    const openApiPaths = swaggerSpec.paths ?? {};

    for (const route of mountedRoutes) {
      const openApiPath = route.fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const pathItem = openApiPaths[openApiPath];
      
      expect(pathItem).toBeDefined();
      if (pathItem) {
        const method = route.method.toLowerCase() as keyof typeof pathItem;
        expect(pathItem[method]).toBeDefined();
      }
    }
  });

  test('OpenAPI spec has security definitions matching auth policies', () => {
    const mountedRoutes = getMountedRoutes();
    const openApiPaths = swaggerSpec.paths ?? {};

    for (const route of mountedRoutes) {
      const openApiPath = route.fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const pathItem = openApiPaths[openApiPath];
      
      if (pathItem) {
        const method = route.method.toLowerCase() as keyof typeof pathItem;
        const operation = pathItem[method] as any;
        
        if (operation && operation.security) {
          const expectedAuth = route.descriptor.auth.type;
          
          if (expectedAuth === 'public') {
            expect(operation.security).toEqual([]);
          } else if (expectedAuth === 'admin') {
            expect(operation.security).toEqual(expect.arrayContaining([expect.objectContaining({ adminKey: [] })]));
          } else if (expectedAuth === 'user' || expectedAuth === 'apiKey') {
            expect(operation.security).toEqual(expect.arrayContaining([
              expect.objectContaining({ bearerAuth: [] }),
              expect.objectContaining({ apiKeyAuth: [] }),
              expect.objectContaining({ cookieAuth: [] }),
            ]));
          }
        }
      }
    }
  });

  test('route inventory can be generated from registry', () => {
    const mountedRoutes = getMountedRoutes();
    expect(mountedRoutes.length).toBeGreaterThan(0);
    
    // Check all routes have required fields
    for (const route of mountedRoutes) {
      expect(route.method).toBeDefined();
      expect(route.path).toBeDefined();
      expect(route.fullPath).toBeDefined();
      expect(route.version).toBeDefined();
      expect(route.descriptor).toBeDefined();
      expect(route.descriptor.auth).toBeDefined();
      expect(route.descriptor.rateLimit).toBeDefined();
      expect(route.descriptor.validation).toBeDefined();
      expect(route.descriptor.handler).toBeDefined();
    }
  });

  test('no route is public without explicit auth policy (fail at startup)', () => {
    // This is verified by the registry validation
    const { validateRegistry } = require('../src/router/registry');
    const validation = validateRegistry();
    
    // The validation should pass (no errors)
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});