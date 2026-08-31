/**
 * Generates OpenAPI path JSDoc blocks from route comments and registrations.
 * Run with: npm run openapi:generate
 */
import * as path from 'path';
import { generateOpenApiPathsFile } from '../src/openapi/route-generator';

const outputPath = path.join(__dirname, '..', 'src', 'openapi', 'generated-paths.ts');
const count = generateOpenApiPathsFile(outputPath);
console.log(`Generated ${count} OpenAPI paths at ${outputPath}`);
