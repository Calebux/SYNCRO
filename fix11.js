const fs = require('fs');

// The errors ARE exported from ../errors/index.ts
// The route files import from '../errors' which should resolve to '../errors/index.ts' automatically
// Problem: our prepended imports are DUPLICATE - the files already import from errors but maybe with wrong name
// Let's check what each file actually imports from errors

const files = {
  'api-keys': 'C:/Users/ADMIN/SYNCRO/backend/src/routes/api-keys.ts',
  'compliance': 'C:/Users/ADMIN/SYNCRO/backend/src/routes/compliance.ts', 
  'digest': 'C:/Users/ADMIN/SYNCRO/backend/src/routes/digest.ts',
  'team': 'C:/Users/ADMIN/SYNCRO/backend/src/routes/team.ts',
};

for (const [name, path] of Object.entries(files)) {
  let c = fs.readFileSync(path, 'utf8');
  const errorImports = c.split('\n').filter(l => l.includes('errors'));
  console.log(name + ' error imports:', errorImports);
}
