const fs = require('fs');
let c = fs.readFileSync('backend/src/routes/compliance.ts', 'utf8');
const lines = c.split('\n');
lines[90] = "    res.setHeader('Content-Disposition', `attachment; filename=\"syncro-data-export-${Date.now()}.zip\"`);";
fs.writeFileSync('backend/src/routes/compliance.ts', lines.join('\n'));
console.log('Fixed line 91:', JSON.stringify(lines[90]));
