#!/usr/bin/env node

/**
 * RLS Audit Local Loader
 * Loads environment variables from .env.local and runs RLS compliance check
 * This replaces hardcoded credentials in npm scripts (security best practice)
 */

const fs = require('fs');
const path = require('path');

// Find root directory
const rootDir = path.resolve(__dirname, '..');

// Load .env.local if it exists
const envLocalPath = path.join(rootDir, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  envContent.split('\n').forEach(line => {
    // Skip comments and empty lines
    if (!line.trim().startsWith('#') && line.includes('=')) {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=').trim();
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  });
}

// Verify required environment variables
const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = requiredVars.filter(v => !process.env[v]);

if (missing.length > 0) {
  console.error('Error: Required environment variables not set:');
  missing.forEach(v => console.error(`  - ${v}`));
  console.error(`\nPlease ensure ${envLocalPath} contains the required variables.`);
  process.exit(1);
}

// Run the RLS compliance check
require('./check-rls-compliance.js');
