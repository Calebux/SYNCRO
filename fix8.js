const fs = require('fs');

// auth.ts - show lines around 85-92
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', 'utf8');
const lines = c.split('\n');
const idx = lines.findIndex(l => l.includes('id: apiKey.user_id'));
console.log('auth idx:', idx, 'next lines:', JSON.stringify(lines.slice(idx, idx+5)));
// Force insert role if not present in next 3 lines
const nearby = lines.slice(idx, idx+4).join('');
if (!nearby.includes('role:')) {
  lines.splice(idx+1, 0, "    role: 'user' as any,");
  c = lines.join('\n');
  fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', c, 'utf8');
  console.log('auth.ts fixed');
} else {
  console.log('auth.ts already has role, nearby:', nearby);
}

// Check what errors imports look like in each file
['api-keys','compliance','digest','team'].forEach(name => {
  const path = name === 'compliance' || name === 'digest' || name === 'api-keys' || name === 'team'
    ? `C:/Users/ADMIN/SYNCRO/backend/src/routes/${name}.ts`
    : null;
  if (!path) return;
  let fc = fs.readFileSync(path, 'utf8');
  const firstLines = fc.split('\n').slice(0,5).join('\n');
  console.log(`\n${name}.ts first 5 lines:`, firstLines);
  
  let changed = false;
  if (name === 'api-keys' && !fc.includes('NotFoundError')) {
    fc = "import { NotFoundError } from '../errors';\n" + fc; changed = true;
  }
  if (name === 'compliance' && !fc.includes('UnauthorizedError')) {
    fc = "import { UnauthorizedError } from '../errors';\n" + fc; changed = true;
  }
  if (name === 'digest' && !fc.includes('BadRequestError')) {
    fc = "import { BadRequestError } from '../errors';\n" + fc; changed = true;
  }
  if (name === 'team' && !fc.includes('NotFoundError')) {
    fc = "import { NotFoundError, BadRequestError } from '../errors';\n" + fc; changed = true;
  }
  if (changed) {
    fs.writeFileSync(path, fc, 'utf8');
    console.log(`${name}.ts imports fixed`);
  }
});
