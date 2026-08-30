/**
 * Benchmark script for performance indexes
 * This script tests query performance before and after adding indexes
 * Run this before and after applying the migration to measure improvements
 * 
 * Usage: node scripts/benchmark-performance-indexes.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Test queries that the indexes optimize
const benchmarkQueries = [
  {
    name: 'Analytics Summary - Active Subscriptions',
    query: async (userId) => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');
      return { data, error };
    },
    description: 'Fetches all active subscriptions for analytics summary'
  },
  {
    name: 'Price History - By Subscription',
    query: async (subscriptionId) => {
      const { data, error } = await supabase
        .from('subscription_price_history')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('changed_at', { ascending: false });
      return { data, error };
    },
    description: 'Fetches price history for a specific subscription'
  },
  {
    name: 'Price History - By User',
    query: async (userId) => {
      const { data, error } = await supabase
        .from('subscription_price_history')
        .select('*')
        .eq('user_id', userId);
      return { data, error };
    },
    description: 'Fetches all price history for a user'
  },
  {
    name: 'Upcoming Renewals - Next 7 Days',
    query: async (userId) => {
      const now = new Date();
      const next7Days = new Date();
      next7Days.setDate(next7Days.getDate() + 7);
      
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gte('next_billing_date', now.toISOString())
        .lte('next_billing_date', next7Days.toISOString());
      return { data, error };
    },
    description: 'Fetches subscriptions renewing in the next 7 days'
  },
  {
    name: 'Budget Alert Deduplication',
    query: async (userId) => {
      const monthStr = new Date().toISOString().substring(0, 7);
      const { data, error } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'budget_alert')
        .like('message', `%${monthStr}%`)
        .limit(1);
      return { data, error };
    },
    description: 'Checks for existing budget alert notification this month'
  },
  {
    name: 'Dismissed Suggestions - Active',
    query: async (userId) => {
      const { data, error } = await supabase
        .from('dismissed_suggestions')
        .select('*')
        .eq('user_id', userId)
        .gt('dismissed_until', new Date().toISOString());
      return { data, error };
    },
    description: 'Fetches currently dismissed suggestions for a user'
  },
  {
    name: 'Category Breakdown',
    query: async (userId) => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('category, price, billing_cycle')
        .eq('user_id', userId)
        .not('category', 'is', null);
      return { data, error };
    },
    description: 'Fetches subscriptions grouped by category'
  },
  {
    name: 'Monthly Budgets - By User',
    query: async (userId) => {
      const { data, error } = await supabase
        .from('monthly_budgets')
        .select('*')
        .eq('user_id', userId);
      return { data, error };
    },
    description: 'Fetches all budgets for a user'
  }
];

async function runBenchmark(userId, subscriptionId) {
  console.log('\n=== Performance Index Benchmark ===\n');
  console.log(`Testing with userId: ${userId}`);
  console.log(`Testing with subscriptionId: ${subscriptionId}\n`);

  const results = [];

  for (const benchmark of benchmarkQueries) {
    const iterations = 5;
    const times = [];

    console.log(`Running: ${benchmark.name}`);
    console.log(`Description: ${benchmark.description}`);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      try {
        const result = await benchmark.query(userId);
        const end = performance.now();
        times.push(end - start);
        
        if (result.error) {
          console.log(`  Iteration ${i + 1}: ERROR - ${result.error.message}`);
          times[i] = -1; // Mark as error
        } else {
          console.log(`  Iteration ${i + 1}: ${times[i].toFixed(2)}ms (${result.data?.length || 0} rows)`);
        }
      } catch (error) {
        console.log(`  Iteration ${i + 1}: ERROR - ${error.message}`);
        times[i] = -1;
      }
    }

    const validTimes = times.filter(t => t !== -1);
    const avgTime = validTimes.length > 0 
      ? validTimes.reduce((a, b) => a + b, 0) / validTimes.length 
      : 0;
    const minTime = validTimes.length > 0 ? Math.min(...validTimes) : 0;
    const maxTime = validTimes.length > 0 ? Math.max(...validTimes) : 0;

    results.push({
      name: benchmark.name,
      avgTime: avgTime.toFixed(2),
      minTime: minTime.toFixed(2),
      maxTime: maxTime.toFixed(2),
      successRate: `${(validTimes.length / iterations) * 100}%`
    });

    console.log(`  Average: ${avgTime.toFixed(2)}ms | Min: ${minTime.toFixed(2)}ms | Max: ${maxTime.toFixed(2)}ms\n`);
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
    await runBenchmark(testData.userId, testData.subscriptionId);
  } catch (error) {
    console.error('Benchmark failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runBenchmark, benchmarkQueries };
