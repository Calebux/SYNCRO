const fs = require('fs');

// Fix 1: auth.ts - duplicate email, add role to api_key branch
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', 'utf8');
c = c.replace('    email: string;\r\n    role: UserRole;\r\n    email?: string;', '    email?: string;\r\n    role: UserRole;');
c = c.replace('  req.user = {\r\n    id: apiKey.user_id,\r\n    authMethod: \'api_key\',\r\n    scopes: apiKey.scopes || [],\r\n  };', '  req.user = {\r\n    id: apiKey.user_id,\r\n    role: \'user\' as UserRole,\r\n    authMethod: \'api_key\',\r\n    scopes: apiKey.scopes || [],\r\n  };');
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', c, 'utf8');
console.log('auth.ts done');

// Fix 2: push-notifications.ts - add missing z import
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/push-notifications.ts', 'utf8');
if (!c.includes("import { z }")) {
  c = "import { z } from 'zod';\r\n" + c;
}
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/push-notifications.ts', c, 'utf8');
console.log('push-notifications.ts done');

// Fix 3: health-service.ts - duplicate import
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/health-service.ts', 'utf8');
c = c.replace("import type { EventListenerHealth } from './event-listener';\r\n", '');
c = c.replace("import type { EventListenerHealth } from './event-listener';\n", '');
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/health-service.ts', c, 'utf8');
console.log('health-service.ts done');

// Fix 4: rateLimiter.ts - type assertion
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/rateLimiter.ts', 'utf8');
c = c.replace('redisInitPromise = (async () => {', 'redisInitPromise = (async (): Promise<any> => {');
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/rateLimiter.ts', c, 'utf8');
console.log('rateLimiter.ts done');

// Fix 5: risk-detection errors[] type
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', 'utf8');
c = c.replace('errors: [] }', 'errors: [] as Array<{subscription_id: string; error: string}> }');
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', c, 'utf8');
console.log('risk-detection-service.ts done');

// Fix 6: subscriptions.ts - req.params.id string cast
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/subscriptions.ts', 'utf8');
c = c.replace(/req\.params\.id\b/g, '(req.params.id as string)');
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/subscriptions.ts', c, 'utf8');
console.log('subscriptions.ts done');

// Fix 7: types/reminder.ts - find duplicate fields
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/types/reminder.ts', 'utf8');
console.log('reminder.ts length:', c.length, '- needs manual check');

console.log('All done');
