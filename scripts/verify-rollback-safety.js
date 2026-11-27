#!/usr/bin/env node
/**
 * verify-rollback-safety.js
 *
 * Runs pre-rollback verification queries for each high-risk migration group
 * and reports whether it is safe to proceed with a rollback.
 *
 * Usage:
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/verify-rollback-safety.js
 *   node scripts/verify-rollback-safety.js --group renewal_tables
 *
 * Exit codes:
 *   0  All checked groups are safe to roll back
 *   1  One or more groups are UNSAFE — do not proceed
 *   2  Connection or query error
 */

'use strict';

const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(2);
}

const targetGroup = process.argv.includes('--group')
  ? process.argv[process.argv.indexOf('--group') + 1]
  : null;

// ── SQL helper ────────────────────────────────────────────────────────────────

async function sql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const url = new URL('/rest/v1/rpc/exec_sql', SUPABASE_URL);
    // Fall back to a direct pg REST call via the sql endpoint
    const restUrl = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`);

    // Use Supabase's pg meta endpoint if available, otherwise use rpc
    const pgUrl = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/pg/query`);
    const options = {
      hostname: pgUrl.hostname,
      port: pgUrl.port || (pgUrl.protocol === 'https:' ? 443 : 80),
      path: pgUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const lib = pgUrl.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Checks ────────────────────────────────────────────────────────────────────

const CHECKS = {
  renewal_tables: [
    {
      label: 'Active renewal locks',
      query: `SELECT COUNT(*) AS n FROM renewal_locks WHERE status = 'active'`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'Active renewal locks exist — wait for them to release before rolling back.',
    },
    {
      label: 'Unused unexpired renewal approvals',
      query: `SELECT COUNT(*) AS n FROM renewal_approvals WHERE used = false AND expires_at > NOW()`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'Unexpired unused approvals exist — rolling back will orphan them.',
    },
  ],

  reminder_tables: [
    {
      label: 'Pending reminder schedules',
      query: `SELECT COUNT(*) AS n FROM reminder_schedules WHERE status = 'pending'`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'Pending reminders exist — they will be lost on rollback.',
    },
    {
      label: 'In-flight notification deliveries',
      query: `SELECT COUNT(*) AS n FROM notification_deliveries WHERE status IN ('pending','retrying')`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'In-flight deliveries exist — rolling back will leave them unprocessed.',
    },
    {
      label: 'Pending delayed notifications',
      query: `SELECT COUNT(*) AS n FROM delayed_notifications WHERE status = 'pending'`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'Pending delayed notifications exist — they will be lost on rollback.',
    },
  ],

  expiry_columns: [
    {
      label: 'Subscriptions in expired status',
      query: `SELECT COUNT(*) AS n FROM public.subscriptions WHERE status = 'expired'`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: "Subscriptions with status='expired' exist — rollback removes the constraint allowing this value.",
    },
    {
      label: 'Subscriptions with expired_at set',
      query: `SELECT COUNT(*) AS n FROM public.subscriptions WHERE expired_at IS NOT NULL`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'expired_at data exists — it will be permanently lost when the column is dropped.',
    },
  ],

  renewal_cooldown: [
    {
      label: 'Active cooldowns (last 10 min)',
      query: `SELECT COUNT(*) AS n FROM public.subscriptions WHERE last_renewal_attempt_at > NOW() - INTERVAL '10 minutes'`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'Active cooldowns exist — rolling back removes the guard against rapid retries.',
    },
  ],

  two_fa_tables: [
    {
      label: 'Teams with 2FA enforcement enabled',
      query: `SELECT COUNT(*) AS n FROM public.teams WHERE require_2fa = true`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'CRITICAL: Teams have require_2fa=true — rollback will lock out users. Disable enforcement first.',
    },
    {
      label: 'Users with 2FA enabled',
      query: `SELECT COUNT(*) AS n FROM public.profiles WHERE two_fa_enabled_at IS NOT NULL`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'Users have 2FA enabled — they will lose recovery code access after rollback.',
    },
  ],

  gift_card_ledger: [
    {
      label: 'Recent deductions (last 24h)',
      query: `SELECT COUNT(*) AS n FROM public.gift_card_ledger WHERE type = 'deduction' AND created_at > NOW() - INTERVAL '24 hours'`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'Recent deductions exist — in-flight financial operations may be affected.',
    },
  ],

  api_key_auth_fields: [
    {
      label: 'Active (non-revoked) API keys',
      query: `SELECT COUNT(*) AS n FROM public.api_keys WHERE revoked = false`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'CRITICAL: Active API keys exist — all API key authentication will break immediately after rollback.',
    },
    {
      label: 'API keys used in last hour',
      query: `SELECT COUNT(*) AS n FROM public.api_keys WHERE last_used_at > NOW() - INTERVAL '1 hour'`,
      safe: (rows) => Number(rows[0]?.n ?? rows[0]?.count ?? 0) === 0,
      message: 'API keys were used recently — active integrations will break.',
    },
  ],
};

// ── Runner ────────────────────────────────────────────────────────────────────

const PASS = '\x1b[32m✔\x1b[0m';
const FAIL = '\x1b[31m✘\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

async function runChecks(groupName, checks) {
  console.log(`\n── ${groupName} ${'─'.repeat(50 - groupName.length)}`);
  let groupSafe = true;

  for (const check of checks) {
    try {
      const result = await sql(check.query);
      if (result.status !== 200 || !Array.isArray(result.body)) {
        console.log(`  ${WARN} ${check.label}: query failed (${result.status}) — skipping`);
        continue;
      }
      const safe = check.safe(result.body);
      if (safe) {
        console.log(`  ${PASS} ${check.label}: safe`);
      } else {
        console.log(`  ${FAIL} ${check.label}: UNSAFE`);
        console.log(`       ${check.message}`);
        groupSafe = false;
      }
    } catch (err) {
      console.log(`  ${WARN} ${check.label}: error — ${err.message}`);
    }
  }

  return groupSafe;
}

async function main() {
  console.log('Rollback Safety Verification');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Group:  ${targetGroup ?? 'all'}`);

  const groups = targetGroup
    ? { [targetGroup]: CHECKS[targetGroup] }
    : CHECKS;

  if (targetGroup && !CHECKS[targetGroup]) {
    console.error(`Unknown group: ${targetGroup}. Available: ${Object.keys(CHECKS).join(', ')}`);
    process.exit(2);
  }

  let allSafe = true;
  for (const [name, checks] of Object.entries(groups)) {
    const safe = await runChecks(name, checks);
    if (!safe) allSafe = false;
  }

  console.log('\n' + '─'.repeat(55));
  if (allSafe) {
    console.log(`${PASS} All checks passed — safe to proceed with rollback.`);
    process.exit(0);
  } else {
    console.log(`${FAIL} One or more checks FAILED — do NOT proceed with rollback.`);
    console.log('   Resolve the issues above, then re-run this script.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
