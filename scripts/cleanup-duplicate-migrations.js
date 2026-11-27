const fs = require('fs');
const path = require('path');

const backendMigrationsDir = path.join(__dirname, '..', 'backend', 'migrations');

const duplicates = [
    'create_audit_logs.sql',
    'create_renewal_tables.sql',
    'create_team_invitations.sql',
    'add_pause_columns.sql'
];

console.log('🧹 Cleaning up duplicate backend migrations...');
let successCount = 0;

duplicates.forEach(file => {
    const filePath = path.join(backendMigrationsDir, file);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✅ Deleted: backend/migrations/${file}`);
        successCount++;
    }
});

console.log(`\n✨ Cleanup complete! Removed ${successCount} duplicate files.`);