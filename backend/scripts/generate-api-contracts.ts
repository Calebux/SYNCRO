import fs from 'fs';
import path from 'path';
import { swaggerSpec } from '../src/swagger';

type Operation = { operationId?: string };
const operations = Object.entries(swaggerSpec.paths ?? {}).flatMap(([route, item]) =>
  Object.entries(item ?? {})
    .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
    .map(([method, operation]) => ({
      key: `${method.toUpperCase()} ${route}`,
      id: (operation as Operation).operationId ?? `${method}_${route}`.replace(/[^a-zA-Z0-9]+/g, '_'),
    })),
);

const source = `// Generated from src/openapi; do not edit.\n` +
  `export const operations = ${JSON.stringify(operations)} as const;\n` +
  `export type OperationKey = typeof operations[number]['key'];\n` +
  `export type ContractHandler<K extends OperationKey, Request, Response> = ` +
  `(request: Request & { operation: K }) => Promise<Response>;\n`;

for (const output of [
  path.join(__dirname, '..', 'src', 'openapi', 'generated-contracts.ts'),
  path.join(__dirname, '..', '..', 'sdk', 'src', 'generated', 'api-contracts.ts'),
]) fs.writeFileSync(output, source);
