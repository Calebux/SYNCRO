const fs = require('fs');

// Fix auth.ts - find the api_key req.user block and add role
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', 'utf8');
const lines = c.split('\n');
// Find req.user = { near apiKey
const idx = lines.findIndex(l => l.includes('req.user = {') && lines.slice(Math.max(0,lines.indexOf(l)-5), lines.indexOf(l)).join('').includes('apiKey'));
console.log('req.user idx:', idx);
// Just cast req.user assignment as any
c = c.replace('req.user = {\n    id: apiKey', 'req.user = {\n    role: \'user\' as any,\n    id: apiKey');
c = c.replace('req.user = {\r\n    id: apiKey', 'req.user = {\r\n    role: \'user\' as any,\r\n    id: apiKey');
// If still not found, show context around line 87
const l87 = lines.slice(83, 95);
console.log('lines 84-95:', JSON.stringify(l87));
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/middleware/auth.ts', c, 'utf8');
console.log('auth.ts done');

// Fix all 4 route files - append imports at very top before anything
const fixes = {
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/api-keys.ts': "import { NotFoundError } from '../errors';\n",
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/compliance.ts': "import { UnauthorizedError } from '../errors';\n",
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/digest.ts': "import { BadRequestError } from '../errors';\n",
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/team.ts': "import { NotFoundError, BadRequestError } from '../errors';\n",
};
for (const [path, imp] of Object.entries(fixes)) {
  let fc = fs.readFileSync(path, 'utf8');
  const needed = imp.match(/{ (.+) }/)[1].split(', ');
  const missing = needed.filter(n => !fc.includes(n));
  if (missing.length > 0) {
    fc = imp + fc;
    fs.writeFileSync(path, fc, 'utf8');
    console.log(path.split('/').pop(), 'fixed - added:', missing.join(', '));
  } else {
    console.log(path.split('/').pop(), 'already has all imports - checking if exported from errors...');
    // Maybe errors.ts doesn't export them - check
    const errPath = 'C:/Users/ADMIN/SYNCRO/backend/src/errors.ts';
    const errIdx = 'C:/Users/ADMIN/SYNCRO/backend/src/errors/index.ts';
    try {
      const errC = fs.readFileSync(errPath, 'utf8');
      console.log('errors.ts exports:', errC.slice(0,500));
    } catch(e) {
      try {
        const errC = fs.readFileSync(errIdx, 'utf8');
        console.log('errors/index.ts exports:', errC.slice(0,500));
      } catch(e2) { console.log('errors file not found at either path'); }
    }
  }
}
