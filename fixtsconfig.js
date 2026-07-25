const fs = require('fs');
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/tsconfig.json', 'utf8');
const cfg = JSON.parse(c);
if (!cfg.exclude) cfg.exclude = [];
if (!cfg.exclude.includes('src/subscription-renewal-history-timeline')) {
  cfg.exclude.push('src/subscription-renewal-history-timeline');
}
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/tsconfig.json', JSON.stringify(cfg, null, 2), 'utf8');
console.log('tsconfig updated');
