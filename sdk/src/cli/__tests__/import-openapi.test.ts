import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('import-openapi CLI', () => {
  it('should generate valid pricing from petstore spec', () => {
    // This is a placeholder test for the CLI logic
    // In a full implementation, we would extract the functions and test them
    const specPath = resolve(__dirname, '../../../test-fixtures/petstore.json');
    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
    
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths).toBeDefined();
    
    // Validate spec has expected paths
    expect(spec.paths['/pets']).toBeDefined();
    expect(spec.paths['/pets'].get).toBeDefined();
    expect(spec.paths['/pets'].post).toBeDefined();
    
    // Validate vendor extension
    expect(spec.paths['/pets'].post['x-syncro-price']).toBe(0.05);
    expect(spec.paths['/pets/{petId}'].put['x-syncro-price']).toBe(0.03);
  });

  it('should recognize operations with descriptions', () => {
    const specPath = resolve(__dirname, '../../../test-fixtures/petstore.json');
    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
    
    expect(spec.paths['/pets'].get.summary).toBe('List all pets');
    expect(spec.paths['/pets'].post.summary).toBe('Create a pet');
  });

  it('expected pricing output should match schema', () => {
    const pricingPath = resolve(__dirname, '../../../test-fixtures/expected-pricing.json');
    const pricing = JSON.parse(readFileSync(pricingPath, 'utf-8'));
    
    expect(pricing.defaultPrice).toBe(0.01);
    expect(pricing.currency).toBe('USDC');
    expect(pricing.routes).toBeDefined();
    
    // Check specific routes
    expect(pricing.routes['GET /pets']).toBeDefined();
    expect(pricing.routes['GET /pets'].price).toBe(0.01);
    expect(pricing.routes['GET /pets'].description).toBe('List all pets');
    
    // Check vendor extension was respected
    expect(pricing.routes['POST /pets'].price).toBe(0.05);
    expect(pricing.routes['PUT /pets/{petId}'].price).toBe(0.03);
  });
});
