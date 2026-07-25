const fs = require('fs');
let c = fs.readFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/compliance.ts', 'utf8');
const start = c.indexOf('// \u2500\u2500\u2500 Data Export');
const end = c.indexOf('// \u2500\u2500\u2500 Account Deletion');
const rep = `// \u2500\u2500\u2500 Data Export \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

router.get('/export', authenticate, exportRateLimit, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const data = await complianceService.gatherUserData(userId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="syncro-data-export-' + Date.now() + '.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => logger.error('Archiver error:', err));
    archive.pipe(res);
    archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
    archive.append(JSON.stringify(data.subscriptions, null, 2), { name: 'subscriptions.json' });
    archive.append(JSON.stringify(data.notifications, null, 2), { name: 'notifications.json' });
    archive.append(JSON.stringify(data.auditLogs, null, 2), { name: 'audit_logs.json' });
    archive.append(JSON.stringify(data.preferences, null, 2), { name: 'preferences.json' });
    archive.append(JSON.stringify(data.emailAccounts, null, 2), { name: 'email_accounts.json' });
    archive.append(JSON.stringify(data.teams, null, 2), { name: 'teams.json' });
    archive.append(JSON.stringify(data.blockchainLogs, null, 2), { name: 'blockchain_logs.json' });
    await archive.finalize();
    await supabase.from('audit_logs').insert({ user_id: userId, action: 'data_export', resource_type: 'account', resource_id: userId, metadata: { exported_at: new Date().toISOString() } });
    logger.info('Data export completed for user ' + userId);
  } catch (error) {
    logger.error('Data export error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to export data' });
  }
});

`;
c = c.slice(0, start) + rep + c.slice(end);
fs.writeFileSync('C:/Users/ADMIN/SYNCRO/backend/src/routes/compliance.ts', c, 'utf8');
console.log('compliance done');
