const fs = require('fs');
const c = fs.readFileSync('backend/src/routes/compliance.ts', 'utf8');
const lines = c.split('\n');
lines.forEach((l, i) => {
  if (l.includes('`')) console.log(i+1, JSON.stringify(l));
});
