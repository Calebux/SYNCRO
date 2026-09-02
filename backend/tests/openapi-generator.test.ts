import { buildRouteRegistry } from '../src/routes/route-registry';
import { generateOpenApiFromRegistry } from '../src/routes/registry/openapi';
import { RouteRegistry } from '../src/routes/registry/registry';

describe('openapi registry generator', () => {
  let registry: RouteRegistry;

  beforeAll(() => {
    registry = buildRouteRegistry();
  });

  test('registry contains all declared descriptors', () => {
    const descriptors = registry.getDescriptors();
    expect(descriptors.length).toBeGreaterThanOrEqual(40);
  });

  test('generates valid OpenAPI document from registry', () => {
    const spec = generateOpenApiFromRegistry(registry);
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths).toBeDefined();

    const paths = Object.keys(spec.paths ?? {});
    expect(paths.length).toBeGreaterThanOrEqual(10);
  });

  test('generates plain-text inventory from registry', () => {
    const inventory = registry.generateInventory();
    expect(inventory).toContain('SYNCRO API Route Inventory');
    expect(inventory).toContain('Total descriptors:');
  });

  test('all descriptors have explicit auth policy', () => {
    const descriptors = registry.getDescriptors();
    for (const d of descriptors) {
      expect(d.auth).toBeDefined();
      expect(['public', 'user', 'admin']).toContain(d.auth);
    }
  });
});
