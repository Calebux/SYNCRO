import { Router } from 'express';
import { registerRoute, createVersionedRouter, getMountedRoutes, validateRegistry } from './registry';
import { userRoutes } from '../routes/user.descriptors';
import { subscriptionRoutes } from '../routes/subscriptions.descriptors';

export function createApiRouter(): Router {
  const v1Router = createVersionedRouter({ basePath: '/api', version: 'v1' });

  for (const descriptor of userRoutes) {
    registerRoute(v1Router, descriptor, { basePath: '/api', version: 'v1' });
  }

  for (const descriptor of subscriptionRoutes) {
    registerRoute(v1Router, descriptor, { basePath: '/api', version: 'v1' });
  }

  const validation = validateRegistry();
  if (!validation.valid) {
    console.error('Route registry validation failed:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Route registry validation failed in production');
    }
  }

  return v1Router;
}

export { getMountedRoutes, validateRegistry };