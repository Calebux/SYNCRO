/**
 * Generates OpenAPI spec from the router registry.
 * Run with: npm run openapi:generate
 */
import * as fs from 'fs';
import * as path from 'path';
import { swaggerSpec } from '../src/swagger';
import { generateOpenApiSpecFromRegistry } from '../src/router/openapi-generator';
import { createApiRouter } from '../src/router/mount';

const outputPath = path.join(__dirname, '..', 'src', 'openapi', 'generated-from-registry.ts');

function generate() {
  // Create the API router to populate the registry
  createApiRouter();

  // Generate the OpenAPI spec from the registry
  const newSpec = generateOpenApiSpecFromRegistry(swaggerSpec);

  // Write the generated paths as JSDoc comments for swagger-jsdoc
  const paths = newSpec.paths || {};
  const blocks: string[] = [];

  for (const [routePath, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!operation || typeof operation !== 'object') continue;
      const op = operation as any;

      const summary = op.summary || `${method.toUpperCase()} ${routePath}`;
      const tags = op.tags || ['API'];
      const security = op.security || [];
      const deprecated = op.deprecated || false;
      const x402 = op['x-x402-payment']?.enabled || false;

      let securityBlock = '';
      if (security.length > 0) {
        const schemes = security.flatMap((s: any) => Object.keys(s));
        if (schemes.includes('adminKey')) {
          securityBlock = ` *     security:
 *       - adminKey: []`;
        } else if (schemes.includes('bearerAuth')) {
          securityBlock = ` *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *       - cookieAuth: []`;
        }
      }

      let x402Block = '';
      if (x402) {
        x402Block = ` *     x-x402-payment:
 *       enabled: true
 *       description: Supports HTTP 402 micropayments via PAYMENT-SIGNATURE header
`;
      }

      const params = op.parameters || [];
      const paramBlock = params.length > 0
        ? params.map((p: any) => ` *       - in: ${p.in}\n *         name: ${p.name}\n *         ${p.required ? 'required: true' : ''}\n *         schema:\n *           $ref: ${p.schema?.$ref || '#'}`).join('\n')
        : '';

      const responses = op.responses || {};
      const responseBlock = Object.entries(responses).map(([code, resp]: [string, any]) => 
        ` *       ${code}:\n *         description: ${resp.description}`
      ).join('\n');

      blocks.push(`/**
 * @openapi
 * ${routePath}:
 *   ${method}:
 *     summary: ${summary}
 *     tags: [${tags.join(', ')}]
${securityBlock}
${x402Block} *     parameters:
${paramBlock}
 *     responses:
${responseBlock}
${deprecated ? ' *     deprecated: true' : ''}
 */`);
    }
  }

  const content = `/**
 * AUTO-GENERATED FILE — do not edit manually.
 * Regenerate with: npm run openapi:generate
 *
 * OpenAPI path definitions generated from router registry.
 */
${blocks.join('\n\n')}
`;

  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${Object.keys(paths).length} OpenAPI paths at ${outputPath}`);

  // Also write the full spec for testing
  const specOutputPath = path.join(__dirname, '..', 'src', 'openapi', 'registry-spec.json');
  fs.writeFileSync(specOutputPath, JSON.stringify(newSpec, null, 2));
  console.log(`Full OpenAPI spec written to ${specOutputPath}`);

  // Generate route inventory
  const inventoryPath = path.join(__dirname, '..', 'src', 'openapi', 'route-inventory.md');
  const inventory = generateRouteInventory(newSpec);
  fs.writeFileSync(inventoryPath, inventory);
  console.log(`Route inventory written to ${inventoryPath}`);
}

function generateRouteInventory(spec: any): string {
  const paths = spec.paths || {};
  const lines = [
    '# API Route Inventory (from Registry)',
    '',
    'Generated from router registry. Do not edit manually.',
    '',
    '| Method | Path | Version | Auth | Rate Limit | Tags |',
    '|--------|------|---------|------|------------|------|',
  ];

  for (const [routePath, pathItem] of Object.entries(paths).sort((a, b) => a[0].localeCompare(b[0]))) {
    const pathItemObj = pathItem as any;
    for (const [method, operation] of Object.entries(pathItemObj)) {
      if (!operation || typeof operation !== 'object') continue;
      const op = operation as any;

      const security = op.security || [];
      let auth = 'public';
      if (security.some((s: any) => s.adminKey)) auth = 'admin';
      else if (security.some((s: any) => s.bearerAuth || s.apiKeyAuth)) auth = 'user';

      const tags = (op.tags || ['API']).join(', ');
      lines.push(`| ${method.toUpperCase()} | ${routePath} | v1 | ${auth} | standard | ${tags} |`);
    }
  }

  return lines.join('\n');
}

generate();