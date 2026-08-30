import { collectRouteDefinitions, generateOpenApiPathsFile } from '../src/openapi/route-generator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('openapi route generator', () => {
  test('collects routes from route files and index.ts', () => {
    const routes = collectRouteDefinitions();
    expect(routes.length).toBeGreaterThan(150);

    const subscriptionList = routes.find(
      (route) => route.method === 'get' && route.path === '/api/subscriptions',
    );
    expect(subscriptionList).toBeDefined();
    expect(subscriptionList?.summary).toMatch(/subscription/i);
  });

  test('marks payment routes as x402-capable', () => {
    const routes = collectRouteDefinitions();
    const paystackInit = routes.find(
      (route) => route.path === '/api/payments/paystack/initialize' && route.method === 'post',
    );
    expect(paystackInit?.x402).toBe(true);
  });

  test('generates valid OpenAPI JSDoc output', () => {
    const tmpFile = path.join(os.tmpdir(), `syncro-openapi-${Date.now()}.ts`);
    const count = generateOpenApiPathsFile(tmpFile);
    const content = fs.readFileSync(tmpFile, 'utf8');

    expect(count).toBeGreaterThan(150);
    expect(content).toContain('@openapi');
    expect(content).toContain('PAYMENT-SIGNATURE');
    expect(content).not.toContain("PaymentSignatureHeader' *     responses:");

    fs.unlinkSync(tmpFile);
  });
});
