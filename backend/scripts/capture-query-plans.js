/**
 * Query Plan Capture Script
 * This script captures EXPLAIN ANALYZE output for queries that the indexes optimize
 * Run this before and after applying the migration to compare query plans
 * 
 * Usage: node scripts/capture-query-plans.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// SQL queries to analyze with EXPLAIN ANALYZE
const queriesToAnalyze = [
  {
    name: 'Analytics Summary - Active Subscriptions',
    sql: (userId) => `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT * FROM subscriptions 
      WHERE user_id = '${userId}'::uuid 
      AND status = 'active'
    `,
    description: 'Fetches all active subscriptions for analytics summary'
  },
  {
    name: 'Price History - By Subscription',
    sql: (subscriptionId) => `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT * FROM subscription_price_history 
      WHERE subscription_id = '${subscriptionId}'::uuid 
      ORDER BY changed_at DESC
    `,
    description: 'Fetches price history for a specific subscription'
  },
  {
    name: 'Price History - By User',
    sql: (userId) => `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT * FROM subscription_price_history 
      WHERE user_id = '${userId}'::uuid
    `,
    description: 'Fetches all price history for a user'
  },
  {
    name: 'Upcoming Renewals - Next 7 Days',
    sql: (userId) => {
      const now = new Date();
      const next7Days = new Date();
      next7Days.setDate(next7Days.getDate() + 7);
      return `
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT * FROM subscriptions 
        WHERE user_id = '${userId}'::uuid 
        AND status = 'active'
        AND next_billing_date >= '${now.toISOString()}'::timestamptz
        AND next_billing_date <= '${next7Days.toISOString()}'::timestamptz
      `;
    },
    description: 'Fetches subscriptions renewing in the next 7 days'
  },
  {
    name: 'Budget Alert Deduplication',
    sql: (userId) => {
      const monthStr = new Date().toISOString().substring(0, 7);
      return `
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id FROM notifications 
        WHERE user_id = '${userId}'::uuid 
        AND type = 'budget_alert'
        AND message LIKE '%${monthStr}%'
        LIMIT 1
      `;
    },
    description: 'Checks for existing budget alert notification this month'
  },
  {
    name: 'Dismissed Suggestions - Active',
    sql: (userId) => `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT * FROM dismissed_suggestions 
      WHERE user_id = '${userId}'::uuid 
      AND dismissed_until > NOW()
    `,
    description: 'Fetches currently dismissed suggestions for a user'
  },
  {
    name: 'Category Breakdown',
    sql: (userId) => `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT category, price, billing_cycle FROM subscriptions 
      WHERE user_id = '${userId}'::uuid 
      AND category IS NOT NULL
    `,
    description: 'Fetches subscriptions grouped by category'
  },
  {
    name: 'Monthly Budgets - By User',
    sql: (userId) => `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT * FROM monthly_budgets 
      WHERE user_id = '${userId}'::uuid
    `,
    description: 'Fetches all budgets for a user'
  }
];

async function captureQueryPlans(userId, subscriptionId) {
  console.log('\n=== Query Plan Capture ===\n');
  console.log(`Testing with userId: ${userId}`);
  console.log(`Testing with subscriptionId: ${subscriptionId}\n`);

  const results = [];

  for (const query of queriesToAnalyze) {
    console.log(`Analyzing: ${query.name}`);
    console.log(`Description: ${query.description}`);

    try {
      const sql = typeof query.sql === 'function' 
        ? query.sql(subscriptionId || userId) 
        : query.sql;

      const { data, error } = await supabase.rpc('exec_sql', { sql });

      if (error) {
        console.log(`  ERROR: ${error.message}\n`);
        results.push({
          name: query.name,
          status: 'ERROR',
          error: error.message
        });
        continue;
      }

      const plan = data;
      const executionTime = plan[0]?.['Execution Time'] || 'N/A';
      const planningTime = plan[0]?.['Planning Time'] || 'N/A';
      
      // Extract index usage information
      const planText = JSON.stringify(plan, null, 2);
      const usesIndex = planText.includes('Index Scan') || planText.includes('Index Only Scan');
      const usesSeqScan = planText.includes('Seq Scan');
      
      console.log(`  Execution Time: ${executionTime}ms`);
      console.log(`  Planning Time: ${planningTime}ms`);
      console.log(`  Uses Index: ${usesIndex ? 'YES' : 'NO'}`);
      console.log(`  Uses Seq Scan: ${usesSeqScan ? 'YES' : 'NO'}`);
      console.log(`  Plan saved to: query-plans/${query.name.replace(/\s+/g, '_')}.json\n`);

      // Save plan to file
      const fs = require('fs');
      const path = require('path');
      const plansDir = path.join(__dirname, '..', 'query-plans');
      
      if (!fs.existsSync(plansDir)) {
        fs.mkdirSync(plansDir, { recursive: true });
      }
      
      const planFile = path.join(plansDir, `${query.name.replace(/\s+/g, '_')}.json`);
      fs.writeFileSync(planFile, JSON.stringify({
        name: query.name,
        description: query.description,
        executionTime,
        planningTime,
        usesIndex,
        usesSeqScan,
        plan,
        capturedAt: new Date().toISOString()
      }, null, 2));

      results.push({
        name: query.name,
        status: 'SUCCESS',
        executionTime,
        planningTime,
        usesIndex,
        usesSeqScan
      });

    } catch (error) {
      console.log(`  ERROR: ${error.message}\n`);
      results.push({
        name: query.name,
        status: 'ERROR',
        error: error.message
      });
    }
  }

  console.log('\n=== Summary ===\n');
  console.table(results);

  return results;
}

// Get a test user and subscription
async function getTestData() {
  // Get first user with subscriptions
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('user_id, id')
    .limit(1);

  if (subscriptions && subscriptions.length > 0) {
    return {
      userId: subscriptions[0].user_id,
      subscriptionId: subscriptions[0].id
    };
  }

  // Fallback: try to get any user
  const { data: users } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  if (users && users.length > 0) {
    return {
      userId: users[0].id,
      subscriptionId: null
    };
  }

  throw new Error('No test data found. Please ensure the database has test data.');
}

// Main execution
async function main() {
  try {
    const testData = await getTestData();
    await captureQueryPlans(testData.userId, testData.subscriptionId);
  } catch (error) {
    console.error('Query plan capture failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { captureQueryPlans, queriesToAnalyze };
