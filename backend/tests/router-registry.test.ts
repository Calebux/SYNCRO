import request from 'supertest';
import express from 'express';
import { createApiRouter, getMountedRoutes, validateRegistry } from '../src/router/mount';
import { createDescriptor, auth, validate, audit } from '../src/router/descriptors';
import { z } from 'zod';
import { RateLimiterFactory } from '../src/middleware/rate-limit-factory';

describe('Router Registry', () => {
  let app: express.Express;

  beforeAll(async () => {
    await RateLimiterFactory.initializeRedisStore();
    // Small delay to ensure initialization is complete
    await new Promise(resolve => setTimeout(resolve, 100));
    app = express();
    app.use(express.json());
    const apiRouter = createApiRouter();
    console.log('Mounted routes:', getMountedRoutes().map(r => `${r.method} ${r.fullPath}`));
    app.use(apiRouter);
  });

  test('creates API router with registered routes', () => {
    const routes = getMountedRoutes();
    expect(routes.length).toBeGreaterThan(0);
    
    const userRoutes = routes.filter(r => r.fullPath.startsWith('/api/user'));
    expect(userRoutes.length).toBeGreaterThan(0);
    
    const subRoutes = routes.filter(r => r.fullPath.startsWith('/api/subscriptions'));
    expect(subRoutes.length).toBeGreaterThan(0);
  });

  test('validates registry - no public routes under /api', () => {
    const validation = validateRegistry();
    expect(validation.valid).toBe(true);
  });

  test('user routes require authentication', async () => {
    const response = await request(app).get('/api/user/profile');
    expect(response.status).toBe(401);
  });

  test('subscription routes require authentication', async () => {
    const response = await request(app).get('/api/subscriptions');
    expect(response.status).toBe(401);
  });
});

describe('Route Descriptors', () => {
  test('createDescriptor creates valid descriptor', () => {
    const descriptor = createDescriptor({
      method: 'get',
      path: '/test',
      version: 'v1',
      handler: () => {},
      auth: auth.user(),
      summary: 'Test endpoint',
      tags: ['Test'],
    });

    expect(descriptor.method).toBe('get');
    expect(descriptor.path).toBe('/test');
    expect(descriptor.version).toBe('v1');
    expect(descriptor.auth.type).toBe('user');
    expect(descriptor.summary).toBe('Test endpoint');
    expect(descriptor.tags).toEqual(['Test']);
  });

  test('auth helpers work correctly', () => {
    expect(auth.public()).toEqual({ type: 'public' });
    expect(auth.user()).toEqual({ type: 'user' });
    expect(auth.user(['scope1'])).toEqual({ type: 'user', requiredScopes: ['scope1'] });
    expect(auth.admin()).toEqual({ type: 'admin' });
    expect(auth.apiKey()).toEqual({ type: 'apiKey' });
  });

  test('validation helpers work correctly', () => {
    const schema = z.object({ name: z.string() });
    expect(validate.body(schema)).toEqual({ target: 'body', schema });
    expect(validate.query(schema)).toEqual({ target: 'query', schema });
    expect(validate.params(schema)).toEqual({ target: 'params', schema });
  });

  test('audit helpers work correctly', () => {
    expect(audit.create('resource')).toEqual({
      type: 'create',
      resourceType: 'resource',
      action: 'create',
      includeRequestBody: true,
      includeResponseBody: false,
      severity: 'low',
    });
    expect(audit.read('resource')).toEqual({
      type: 'read',
      resourceType: 'resource',
      action: 'read',
      includeResponseBody: false,
      severity: 'low',
    });
    expect(audit.update('resource')).toEqual({
      type: 'update',
      resourceType: 'resource',
      action: 'update',
      includeRequestBody: true,
      includeResponseBody: false,
      severity: 'low',
    });
    expect(audit.delete('resource')).toEqual({
      type: 'delete',
      resourceType: 'resource',
      action: 'delete',
      severity: 'medium',
    });
    expect(audit.list('resource')).toEqual({
      type: 'list',
      resourceType: 'resource',
      action: 'list',
      severity: 'low',
    });
    expect(audit.none()).toBeNull();
  });
});

describe('Route Registry - OpenAPI generation', () => {
  test('generates route inventory', () => {
    const routes = getMountedRoutes();
    expect(routes.length).toBeGreaterThan(0);
    
    // Check that all routes have required fields
    for (const route of routes) {
      expect(route.method).toBeDefined();
      expect(route.path).toBeDefined();
      expect(route.fullPath).toBeDefined();
      expect(route.version).toBeDefined();
      expect(route.descriptor).toBeDefined();
    }
  });
});