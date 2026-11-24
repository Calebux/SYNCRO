#!/usr/bin/env node

/**
 * Quick syntax validator for the drift check script
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.join(__dirname, 'check-migration-drift.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

try {
  // Try to compile the script
  new vm.Script(scriptContent);
  console.log('✅ check-migration-drift.js: Syntax valid');
  process.exit(0);
} catch (err) {
  console.error('❌ Syntax error in check-migration-drift.js:');
  console.error(err.message);
  process.exit(1);
}
