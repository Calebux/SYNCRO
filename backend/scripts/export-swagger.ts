/**
 * Exports the OpenAPI spec to openapi.json
 * Run with: npx ts-node scripts/export-swagger.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { swaggerSpec } from '../src/swagger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// documentation site can use it as the canonical API surface.
const docsOutputDir = path.join(__dirname, '..', '..', 'docs', 'api-reference');
const outputPath = path.join(docsOutputDir, 'openapi.json');
if (!fs.existsSync(docsOutputDir)) {
	fs.mkdirSync(docsOutputDir, { recursive: true });
}
fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2));
console.log(`OpenAPI spec exported to ${outputPath}`);
