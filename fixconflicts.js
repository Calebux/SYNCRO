const fs = require('fs');

function keepSide(content, side) {
  return content.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g, (_, upstream, stashed) => {
    return side === 'upstream' ? upstream : stashed;
  });
}

// mfa.ts - keep upstream
let f = 'backend/src/routes/mfa.ts';
fs.writeFileSync(f, keepSide(fs.readFileSync(f, 'utf8'), 'upstream'));
console.log('mfa.ts done');

// push-notifications.ts - keep stashed
f = 'backend/src/routes/push-notifications.ts';
fs.writeFileSync(f, keepSide(fs.readFileSync(f, 'utf8'), 'stashed'));
console.log('push-notifications.ts done');

// subscriptions.ts - keep upstream
f = 'backend/src/routes/subscriptions.ts';
fs.writeFileSync(f, keepSide(fs.readFileSync(f, 'utf8'), 'upstream'));
console.log('subscriptions.ts done');

// subscription-service.ts - keep stashed
f = 'backend/src/services/subscription-service.ts';
fs.writeFileSync(f, keepSide(fs.readFileSync(f, 'utf8'), 'stashed'));
console.log('subscription-service.ts done');

// compliance.ts - keep upstream then fix template literals
f = 'backend/src/routes/compliance.ts';
let c = fs.readFileSync(f, 'utf8');
c = keepSide(c, 'upstream');
// The backtick lines got corrupted by PowerShell - fix them
c = c.replace("      `Generated: ${new Date().toISOString()}`,", "      `Generated: ${new Date().toISOString()}`,");
// Find and fix any malformed template literal lines in the readme array
c = c.replace(/`Generated:[^`]*`,/g, '`Generated: ${new Date().toISOString()}`,');
c = c.replace(/`User ID:[^`]*`,/g, '`User ID: ${userId}`,');
fs.writeFileSync(f, c);
console.log('compliance.ts done');
