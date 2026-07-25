const fs = require('fs');

// Fix reminder.ts - remove duplicate block (second "Trial tracking" section)
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/types/reminder.ts', 'utf8');
const dupMarker = '  // Trial tracking\n  is_trial: boolean;\n  trial_ends_at: string | null;\n  trial_converts_to_price: number | null;\n  credit_card_required: boolean;\n  website_url: string | null;\n}';
const dupMarkerWin = '  // Trial tracking\r\n  is_trial: boolean;\r\n  trial_ends_at: string | null;\r\n  trial_converts_to_price: number | null;\r\n  credit_card_required: boolean;\r\n  website_url: string | null;\r\n}';
c = c.replace(dupMarker, '}');
c = c.replace(dupMarkerWin, '}');
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/types/reminder.ts', c, 'utf8');
console.log('reminder.ts done');

// Fix subscription-service.ts - line 269-271 broken query, missing .update() chain
c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/subscription-service.ts', 'utf8');
c = c.replace(
  "        const { error: reminderError } = await client\r\n          .from(\"reminder_schedules\")\r\n        let blockchainResult;",
  "        const { error: reminderError } = await client\r\n          .from(\"reminder_schedules\")\r\n          .update({ status: 'cancelled' })\r\n          .eq('subscription_id', subscriptionId);\r\n        let blockchainResult;"
);
c = c.replace(
  "        const { error: reminderError } = await client\n          .from(\"reminder_schedules\")\n        let blockchainResult;",
  "        const { error: reminderError } = await client\n          .from(\"reminder_schedules\")\n          .update({ status: 'cancelled' })\n          .eq('subscription_id', subscriptionId);\n        let blockchainResult;"
);
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/services/subscription-service.ts', c, 'utf8');
console.log('subscription-service.ts done');

console.log('All done!');
