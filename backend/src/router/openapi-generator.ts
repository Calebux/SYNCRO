import { OpenAPIV3_1 } from 'openapi-types';
import { getOpenApiRoutes } from './registry';
import { z } from 'zod';

function zodToOpenApi(schema: z.ZodTypeAny, visited = new Set<z.ZodTypeAny>()): any {
  if (visited.has(schema)) {
    return { type: 'object' };
  }
  visited.add(schema);

  const def = schema._def;
  const typeName = def.typeName;

  if (typeName === 'ZodString') {
    const checks = def.checks || [];
    const format = checks.find((c: any) => c.kind === 'datetime') ? 'date-time' :
                   checks.find((c: any) => c.kind === 'uuid') ? 'uuid' :
                   checks.find((c: any) => c.kind === 'email') ? 'email' :
                   checks.find((c: any) => c.kind === 'url') ? 'uri' : undefined;
    const enumValues = checks.find((c: any) => c.kind === 'enum')?.values;
    if (enumValues) {
      return { type: 'string', enum: enumValues };
    }
    return { type: 'string', format };
  }

  if (typeName === 'ZodNumber') {
    const checks = def.checks || [];
    const minimum = checks.find((c: any) => c.kind === 'min')?.value;
    const maximum = checks.find((c: any) => c.kind === 'max')?.value;
    const multipleOf = checks.find((c: any) => c.kind === 'multipleOf')?.value;
    return { type: 'number', minimum, maximum, multipleOf };
  }

  if (typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }

  if (typeName === 'ZodArray') {
    const items = zodToOpenApi(def.type, visited);
    const result: any = { type: 'array', items };
    if (def.minLength?.value !== undefined) result.minItems = def.minLength.value;
    if (def.maxLength?.value !== undefined) result.maxItems = def.maxLength.value;
    return result;
  }

  if (typeName === 'ZodObject') {
    const shape = def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const valueSchema = value as z.ZodTypeAny;
      properties[key] = zodToOpenApi(valueSchema, visited);
      if (!valueSchema.isOptional()) {
        required.push(key);
      }
    }

    return { type: 'object', properties, required: required.length > 0 ? required : undefined };
  }

  if (typeName === 'ZodEnum' || typeName === 'ZodNativeEnum') {
    const values = def.values || Object.values(def.enum);
    return { type: 'string', enum: values };
  }

  if (typeName === 'ZodUnion') {
    return {
      anyOf: def.options.map((opt: z.ZodTypeAny) => zodToOpenApi(opt, visited)),
    };
  }

  if (typeName === 'ZodOptional') {
    return zodToOpenApi(def.innerType, visited);
  }

  if (typeName === 'ZodNullable') {
    const inner = zodToOpenApi(def.innerType, visited);
    return { ...inner, nullable: true };
  }

  if (typeName === 'ZodDefault') {
    return zodToOpenApi(def.innerType, visited);
  }

  if (typeName === 'ZodEffects') {
    return zodToOpenApi(def.schema, visited);
  }

  if (typeName === 'ZodPromise') {
    return zodToOpenApi(def.type, visited);
  }

  return { type: 'object' };
}

function schemaToReference(schema: z.ZodTypeAny | undefined, components: OpenAPIV3_1.ComponentsObject, name: string): OpenAPIV3_1.ReferenceObject | undefined {
  if (!schema) return undefined;

  const schemaName = name.replace(/[^a-zA-Z0-9]/g, '');
  const openApiSchema = zodToOpenApi(schema);

  if (!components.schemas) {
    components.schemas = {};
  }

  if (!components.schemas[schemaName]) {
    components.schemas[schemaName] = openApiSchema;
  }

  return { $ref: `#/components/schemas/${schemaName}` };
}

export function generateOpenApiSpecFromRegistry(baseSpec: OpenAPIV3_1.Document): OpenAPIV3_1.Document {
  const routes = getOpenApiRoutes();
  const spec = JSON.parse(JSON.stringify(baseSpec)) as OpenAPIV3_1.Document;

  if (!spec.paths) spec.paths = {};
  if (!spec.components) spec.components = {};

  for (const route of routes) {
    const pathItem: OpenAPIV3_1.PathItemObject = spec.paths[route.path] || {};

    const operation: any = {
      summary: route.summary,
      description: route.description,
      tags: route.tags,
      security: route.security === 'public' ? [] :
                route.security === 'admin' ? [{ adminKey: [] }] :
                [{ bearerAuth: [], apiKeyAuth: [], cookieAuth: [] }],
      responses: {},
      parameters: [],
    };

    if (route.requestBody) {
      const ref = schemaToReference(route.requestBody, spec.components!, `Request${route.method}${route.path.replace(/[^a-zA-Z0-9]/g, '')}`);
      if (ref) {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: ref } },
        };
      }
    }

    if (route.queryParams) {
      const querySchema = zodToOpenApi(route.queryParams);
      for (const [key, value] of Object.entries(querySchema.properties || {})) {
        operation.parameters!.push({
          in: 'query',
          name: key,
          required: (querySchema.required || []).includes(key),
          schema: value,
        });
      }
    }

    if (route.pathParams) {
      const pathSchema = zodToOpenApi(route.pathParams);
      for (const [key, value] of Object.entries(pathSchema.properties || {})) {
        operation.parameters!.push({
          in: 'path',
          name: key,
          required: true,
          schema: value,
        });
      }
    }

    for (const [code, response] of Object.entries(route.responses)) {
      operation.responses![code] = { description: response.description };
    }

    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace';
    pathItem[method] = operation;
    spec.paths[route.path] = pathItem;
  }

  return spec;
}

export function generateRouteInventory(): string {
  const routes = getOpenApiRoutes();
  const lines = [
    '# API Route Inventory',
    '',
    'Generated from router registry. Do not edit manually.',
    '',
    '| Method | Path | Version | Auth | Rate Limit | Tags |',
    '|--------|------|---------|------|------------|------|',
  ];

  for (const route of routes.sort((a, b) => a.path.localeCompare(b.path))) {
    const method = route.method;
    const path = route.path;
    const version = 'v1';
    const auth = route.security;
    const rateLimit = 'standard';
    const tags = route.tags.join(', ');

    lines.push(`| ${method} | ${path} | ${version} | ${auth} | ${rateLimit} | ${tags} |`);
  }

  return lines.join('\n');
}