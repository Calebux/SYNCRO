/**
 * Verification script for Domain Glossary & Data Model compliance
 * Usage: node scripts/check-domain-naming.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const REQUIRED_TERMS = [
  'subscription',
  'renewal',
  'payment',
  'charge',
  'settlement',
  'escrow',
  'channel',
  'card',
  'gift card',
  'stealth payment',
];

const REQUIRED_REFERENCES = [
  { file: 'CONTRIBUTING.md', pattern: /DOMAIN_GLOSSARY_AND_DATA_MODEL\.md/ },
  { file: 'PULL_REQUEST_TEMPLATE.md', pattern: /DOMAIN_GLOSSARY_AND_DATA_MODEL\.md/ },
  { file: '.github/pull_request_template.md', pattern: /DOMAIN_GLOSSARY_AND_DATA_MODEL\.md/ },
  { file: 'docs/INDEX.md', pattern: /DOMAIN_GLOSSARY_AND_DATA_MODEL\.md/ },
  { file: 'docs/adr/ADR_TEMPLATE.md', pattern: /DOMAIN_GLOSSARY_AND_DATA_MODEL\.md/ },
];

function runValidation() {
  console.log('🔍 Running Domain Glossary & Data Model Integrity Check...\n');
  let errors = 0;

  // 1. Check docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md
  const glossaryPath = path.join(ROOT_DIR, 'docs', 'DOMAIN_GLOSSARY_AND_DATA_MODEL.md');
  if (!fs.existsSync(glossaryPath)) {
    console.error('❌ Missing required document: docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md');
    errors++;
  } else {
    const glossaryContent = fs.readFileSync(glossaryPath, 'utf8').toLowerCase();
    for (const term of REQUIRED_TERMS) {
      if (!glossaryContent.includes(term)) {
        console.error(`❌ Domain term "${term}" missing in docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md`);
        errors++;
      }
    }
    console.log('✅ docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md contains all required domain terms.');
  }

  // 2. Check shared/src/types/domain-glossary.ts
  const sharedTypesPath = path.join(ROOT_DIR, 'shared', 'src', 'types', 'domain-glossary.ts');
  if (!fs.existsSync(sharedTypesPath)) {
    console.error('❌ Missing required file: shared/src/types/domain-glossary.ts');
    errors++;
  } else {
    const typesContent = fs.readFileSync(sharedTypesPath, 'utf8');
    if (!typesContent.includes('export const DOMAIN_TERMS')) {
      console.error('❌ Missing export DOMAIN_TERMS in shared/src/types/domain-glossary.ts');
      errors++;
    }
    if (!typesContent.includes('export const DOMAIN_LAYER_MAPPING')) {
      console.error('❌ Missing export DOMAIN_LAYER_MAPPING in shared/src/types/domain-glossary.ts');
      errors++;
    }
    console.log('✅ shared/src/types/domain-glossary.ts contains canonical exports.');
  }

  // 3. Check reference links
  for (const item of REQUIRED_REFERENCES) {
    const filePath = path.join(ROOT_DIR, item.file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Missing file: ${item.file}`);
      errors++;
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (!item.pattern.test(content)) {
      console.error(`❌ Missing domain glossary reference in ${item.file}`);
      errors++;
    } else {
      console.log(`✅ Reference verified in ${item.file}`);
    }
  }

  if (errors > 0) {
    console.error(`\n❌ Domain Glossary Validation failed with ${errors} error(s).`);
    process.exit(1);
  } else {
    console.log('\n🎉 All Domain Glossary & Data Model checks passed successfully!');
  }
}

runValidation();
