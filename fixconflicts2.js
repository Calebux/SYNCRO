const fs = require('fs');

function keepSide(content, side) {
  return content.replace(/<<<<<<< [^\r\n]*\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> [^\r\n]*\r?\n/g, (_, upstream, stashed) => {
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

// compliance.ts - keep upstream
f = 'backend/src/routes/compliance.ts';
let c = fs.readFileSync(f, 'utf8');
c = keepSide(c, 'upstream');
// Fix the two backtick lines that got corrupted - replace with string concat
c = c.replace(/`Generated: \$\{new Date\(\)\.toISOString\(\)\}`,/g, "'Generated: ' + new Date().toISOString() + ','.slice(0,-1),");
c = c.replace(/`User ID: \$\{userId\}`,/g, "'User ID: ' + userId + ','.slice(0,-1),");
// Simpler: just replace those two lines directly
c = c.split('\r\n').map(line => {
  if (line.includes('Generated:') && line.includes('toISOString') && line.trim().startsWith('`')) {
    return "      'Generated: ' + new Date().toISOString(),";
  }
  if (line.includes('User ID:') && line.includes('userId') && line.trim().startsWith('`')) {
    return "      'User ID: ' + userId,";
  }
  return line;
}).join('\r\n');
fs.writeFileSync(f, c);
console.log('compliance.ts done');
