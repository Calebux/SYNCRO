const fs = require('fs');
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', 'utf8');
const bad = '        concurrency: RISK_CALC_CONCURRENCY,\r\n';
const good = '          concurrency: RISK_CALC_CONCURRENCY,\r\n        });\r\n      }\r\n      return result;\r\n    } catch (error) {\r\n      logger.error("Error during risk recalculation:", error);\r\n      throw error;\r\n    }\r\n  }\r\n}\r\n\r\nexport const riskDetectionService = new RiskDetectionService();\r\n';
c = c.replace(bad, good);
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/risk-detection/risk-detection-service.ts', c, 'utf8');
console.log('risk-detection done, length:', c.length);
