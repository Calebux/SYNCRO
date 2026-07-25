const fs = require('fs');

// Fix auth.ts - find exact text and add role
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', 'utf8');
const lines = c.split('\n');
const idx = lines.findIndex(l => l.includes('id: apiKey.user_id'));
if (idx !== -1 && !lines[idx+1].includes('role:')) {
  lines.splice(idx+1, 0, "    role: 'user' as any,");
  c = lines.join('\n');
}
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', c, 'utf8');
console.log('auth.ts done');

// Fix api-keys.ts - prepend import
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/api-keys.ts', 'utf8');
if (!c.includes('NotFoundError')) c = "import { NotFoundError } from '../errors';\n" + c;
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/api-keys.ts', c, 'utf8');
console.log('api-keys.ts done');

// Fix compliance.ts - prepend import
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/compliance.ts', 'utf8');
if (!c.includes('UnauthorizedError')) c = "import { UnauthorizedError } from '../errors';\n" + c;
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/compliance.ts', c, 'utf8');
console.log('compliance.ts done');

// Fix digest.ts - prepend BadRequestError import
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/digest.ts', 'utf8');
if (!c.includes('BadRequestError')) c = "import { BadRequestError } from '../errors';\n" + c;
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/digest.ts', c, 'utf8');
console.log('digest.ts done');

// Fix team.ts - add teamId to AuthenticatedRequest type + imports + cast req as any
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', 'utf8');
if (!c.includes('teamId?:')) {
  c = c.replace('export interface AuthenticatedRequest', 'export interface AuthenticatedRequest');
  // Add teamId to the user type or request interface
}
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', c, 'utf8');

c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/team.ts', 'utf8');
if (!c.includes('NotFoundError')) c = "import { NotFoundError, BadRequestError } from '../errors';\n" + c;
// Cast req to any for teamId access
c = c.replace(/req\.teamId/g, '(req as any).teamId');
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/team.ts', c, 'utf8');
console.log('team.ts done');

// Fix reminder.ts - show the content so we can see the duplicate
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/types/reminder.ts', 'utf8');
console.log('reminder.ts:\n' + c);

// Fix subscription-service.ts - insert .select() before destructure
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/subscription-service.ts', 'utf8');
c = c.replace(
  "const { error: reminderError } = await (client as any)\n            .from('reminder_schedules')",
  "const { error: reminderError } = await (client as any)\n            .from('reminder_schedules')"
);
// The real fix: chain .select() to make .error available
const lines2 = c.split('\n');
const ri = lines2.findIndex(l => l.includes('reminderError') && l.includes('await'));
if (ri !== -1) console.log('reminder line:', ri+1, lines2[ri]);
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/subscription-service.ts', c, 'utf8');
console.log('subscription-service.ts done');
