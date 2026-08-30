const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../src/routes');

function getFilesRecursively(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath));
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
      results.push(filePath);
    }
  });
  return results;
}

const files = getFilesRecursively(ROUTES_DIR);
let totalRoutes = 0;
let validatedRoutes = 0;
let bypassedRoutes = 0;
let unvalidatedRoutes = [];

files.forEach((file) => {
  const content = fs.readFileSync(file, 'utf8');
  const relativePath = path.relative(path.join(__dirname, '../..'), file);

  // Split into lines for analysis
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern to match standard Express route registrations
    // e.g. router.get('/', ...), v1Router.post('/...', ...)
    const routeMatch = line.match(/(?:router|v1Router|integrationRouter)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/i);

    if (routeMatch) {
      totalRoutes++;
      const method = routeMatch[1].toUpperCase();
      const routePath = routeMatch[2];
      const routeLabel = `${method} ${routePath} in ${relativePath}:${i + 1}`;

      // Check 1: Preceding lines for VALIDATION_BYPASS
      let hasBypass = false;
      let bypassReason = '';
      for (let j = Math.max(0, i - 4); j < i; j++) {
        const checkLine = lines[j].trim();
        if (checkLine.startsWith('// VALIDATION_BYPASS:')) {
          hasBypass = true;
          bypassReason = checkLine.substring('// VALIDATION_BYPASS:'.length).trim();
          break;
        }
      }

      if (hasBypass) {
        bypassedRoutes++;
        continue;
      }

      // Check 2: Inline middleware validation or ownership validation
      // We check from current line down to the next 6 lines or until we find standard signature elements
      let routeArgsBlock = '';
      for (let j = i; j < Math.min(lines.length, i + 8); j++) {
        routeArgsBlock += lines[j];
        if (lines[j].includes('=>') || lines[j].includes('function')) {
          break;
        }
      }

      const hasMiddleware = routeArgsBlock.includes('validate(') ||
                            routeArgsBlock.includes('validateSubscriptionOwnership') ||
                            routeArgsBlock.includes('validateBulkSubscriptionOwnership') ||
                            routeArgsBlock.includes('upload.single'); // Multer middleware

      if (hasMiddleware) {
        validatedRoutes++;
        continue;
      }

      // Check 3: Check if body uses validateRequest
      // We look at the body lines following the route definition until the next route or end of file
      let hasBodyValidation = false;
      for (let j = i + 1; j < lines.length; j++) {
        const bodyLine = lines[j];
        if (bodyLine.match(/(?:router|v1Router|integrationRouter)\.(get|post|put|patch|delete)\s*\(/i)) {
          // Reached the next route definition, stop checking body
          break;
        }
        if (bodyLine.includes('validateRequest(') || bodyLine.includes('validateSubscriptionOwnership')) {
          hasBodyValidation = true;
          break;
        }
      }

      if (hasBodyValidation) {
        validatedRoutes++;
        continue;
      }

      unvalidatedRoutes.push(routeLabel);
    }
  }
});

console.log('\n🔍 --- Route Schema Validation Audit ---');
console.log(`Total HTTP Routes Found: ${totalRoutes}`);
console.log(`Successfully Validated:  ${validatedRoutes}`);
console.log(`Validation Bypassed:     ${bypassedRoutes}`);

if (unvalidatedRoutes.length > 0) {
  console.error('\n❌ Error: The following routes are missing request schema validation or a bypass comment:');
  unvalidatedRoutes.forEach((r) => console.error(`  - ${r}`));
  console.error('\nEnsure every route has Zod validation middleware, calls validateRequest() inline,');
  console.error('or documents why validation is not required using: // VALIDATION_BYPASS: <reason> on the line preceding the route.');
  process.exit(1);
} else {
  console.log('\n✅ All Express routes are fully validated! CI check passed.\n');
  process.exit(0);
}
