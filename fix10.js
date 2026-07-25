const fs = require('fs');

// Fix auth.ts - correct field name is keyRecord not apiKey
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', 'utf8');
c = c.replace(
  "  req.user = {\r\n    id: keyRecord.user_id,\r\n    authMethod: 'api_key',",
  "  req.user = {\r\n    id: keyRecord.user_id,\r\n    role: 'user' as any,\r\n    authMethod: 'api_key',"
);
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', c, 'utf8');
console.log('auth.ts fixed');

// Check what errors/index.ts actually exports
const errC = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/errors/index.ts', 'utf8');
console.log('errors/index.ts full content:\n' + errC);
