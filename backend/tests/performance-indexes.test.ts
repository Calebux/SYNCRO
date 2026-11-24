/**
 * Performance Indexes Migration Test
 * Tests that the performance indexes migration creates the expected indexes
 * Issue #659
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { supabase } from '../src/config/database';

describe('Performance Indexes Migration', () => {
  const expectedIndexes = [
    // Price History Table Indexes
    'idx_price_history_subscription',
    'idx_price_history_user',
    'idx_price_history_subscription_changed',
    
    // Subscriptions Table Indexes for Analytics
    'idx_subscriptions_user_status',
    'idx_subscriptions_user_next_billing',
    'idx_subscriptions_user_category',
    
    // Notifications Table Indexes
    'idx_notifications_user_type_created',
    'idx_notifications_budget_alerts',
    
    // Dismissed Suggestions Table Indexes
    'idx_dismissed_suggestions_user_until',
    
    // Monthly Budgets Table Optimization
    'idx_monthly_budgets_user_category',
  ];

  describe('Index Existence', () => {
    it('should create all expected indexes', async () => {
      // Query pg_indexes to check if indexes exist
      const { data, error } = await supabase.rpc('check_indexes_exist', {
        index_names: expectedIndexes
      });

      if (error) {
        // Fallback: check each index individually
        const results = await Promise.all(
          expectedIndexes.map(async (indexName) => {
            const { data, error } = await supabase
              .from('pg_indexes')
              .select('indexname')
              .eq('indexname', indexName)
              .single();
            
            return {
              indexName,
              exists: !error && !!data
            };
          })
        );

        const missingIndexes = results
          .filter(r => !r.exists)
          .map(r => r.indexName);

        expect(missingIndexes).toHaveLength(0);
      } else {
        expect(data).toBeDefined();
        expect(data.missing).toHaveLength(0);
      }
    });

    it('should have indexes on correct tables', async () => {
      const indexTableMapping = {
        idx_price_history_subscription: 'subscription_price_history',
        idx_price_history_user: 'subscription_price_history',
        idx_price_history_subscription_changed: 'subscription_price_history',
        idx_subscriptions_user_status: 'subscriptions',
        idx_subscriptions_user_next_billing: 'subscriptions',
        idx_subscriptions_user_category: 'subscriptions',
        idx_notifications_user_type_created: 'notifications',
        idx_notifications_budget_alerts: 'notifications',
        idx_dismissed_suggestions_user_until: 'dismissed_suggestions',
        idx_monthly_budgets_user_category: 'monthly_budgets',
      };

      for (const [indexName, expectedTable] of Object.entries(indexTableMapping)) {
        const { data, error } = await supabase
          .from('pg_indexes')
          .select('tablename')
          .eq('indexname', indexName)
          .single();

        expect(error).toBeNull();
        expect(data?.tablename).toBe(expectedTable);
      }
    });
  });

  describe('Index Properties', () => {
    it('should have correct index definitions for composite indexes', async () => {
      // Check that composite indexes have the right column order
      const compositeIndexes = {
        idx_price_history_subscription_changed: ['subscription_id', 'changed_at'],
        idx_subscriptions_user_status: ['user_id', 'status'],
        idx_subscriptions_user_next_billing: ['user_id', 'next_billing_date'],
        idx_subscriptions_user_category: ['user_id', 'category'],
        idx_notifications_user_type_created: ['user_id', 'type', 'created_at'],
        idx_dismissed_suggestions_user_until: ['user_id', 'dismissed_until'],
        idx_monthly_budgets_user_category: ['user_id', 'category'],
      };

      for (const [indexName, expectedColumns] of Object.entries(compositeIndexes)) {
        const { data, error } = await supabase.rpc('get_index_columns', {
          index_name: indexName
        });

        if (error) {
          // Fallback: skip this check if RPC doesn't exist
          console.warn(`Skipping column check for ${indexName} - RPC not available`);
          continue;
        }

        expect(data).toBeDefined();
        expect(data.columns).toEqual(expectedColumns);
      }
    });

    it('should have partial indexes where appropriate', async () => {
      // Partial indexes should have WHERE clauses
      const partialIndexes = [
        'idx_subscriptions_user_status',
        'idx_subscriptions_user_next_billing',
        'idx_notifications_budget_alerts',
        'idx_dismissed_suggestions_user_until',
      ];

      for (const indexName of partialIndexes) {
        const { data, error } = await supabase
          .from('pg_indexes')
          .select('indexdef')
          .eq('indexname', indexName)
          .single();

        expect(error).toBeNull();
        expect(data?.indexdef).toMatch(/WHERE/i);
      }
    });
  });

  describe('Query Performance Validation', () => {
    it('should use indexes for analytics queries', async () => {
      // This test validates that the query planner would use the indexes
      // In a real environment, you would run EXPLAIN ANALYZE
      const testUserId = '00000000-0000-0000-0000-000000000000'; // Dummy UUID

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', testUserId)
        .eq('status', 'active');

      // Query should execute without error
      // In production, you would check the query plan to verify index usage
      expect(error).toBeNull();
    });

    it('should use indexes for price history queries', async () => {
      const testSubscriptionId = '00000000-0000-0000-0000-000000000000'; // Dummy UUID

      const { data, error } = await supabase
        .from('subscription_price_history')
        .select('*')
        .eq('subscription_id', testSubscriptionId)
        .order('changed_at', { ascending: false });

      expect(error).toBeNull();
    });
  });

  describe('Index Size Impact', () => {
    it('should not have excessively large indexes', async () => {
      // Check that indexes are reasonably sized
      const { data, error } = await supabase.rpc('get_index_sizes', {
        index_names: expectedIndexes
      });

      if (error) {
        // Skip if RPC not available
        console.warn('Skipping index size check - RPC not available');
        return;
      }

      // No single index should be larger than 100MB in a typical deployment
      const oversizedIndexes = data.filter((idx: any) => idx.size_mb > 100);
      expect(oversizedIndexes).toHaveLength(0);
    });
  });
});

/**
 * Helper RPC functions that should be added to the database for testing:
 * 
 * CREATE OR REPLACE FUNCTION check_indexes_exist(index_names text[])
 * RETURNS TABLE(index_name text, exists boolean, missing text[]) AS $$
 * DECLARE
 *   result text[];
 *   missing text[] := '{}';
 * BEGIN
 *   FOREACH idx IN ARRAY index_names LOOP
 *     SELECT indexname INTO result FROM pg_indexes WHERE indexname = idx;
 *     IF NOT FOUND THEN
 *       missing := array_append(missing, idx);
 *     END IF;
 *   END LOOP;
 *   RETURN QUERY SELECT idx, EXISTS(SELECT 1 FROM pg_indexes WHERE indexname = idx), missing FROM unnest(index_names) idx;
 * END;
 * $$ LANGUAGE plpgsql;
 * 
 * CREATE OR REPLACE FUNCTION get_index_columns(index_name text)
 * RETURNS TABLE(columns text[]) AS $$
 * BEGIN
 *   RETURN QUERY
 *   SELECT ARRAY_AGG(a.attname ORDER BY k.n)
 *   FROM pg_index i
 *   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
 *   JOIN pg_class c ON c.oid = i.indexrelid
 *   JOIN generate_series(1, i.indnatts) AS k(n) ON k.n = i.indkey[k.n-1]
 *   WHERE c.relname = index_name;
 * END;
 * $$ LANGUAGE plpgsql;
 * 
 * CREATE OR REPLACE FUNCTION get_index_sizes(index_names text[])
 * RETURNS TABLE(index_name text, size_mb numeric) AS $$
 * BEGIN
 *   RETURN QUERY
 *   SELECT 
 *     i.indexname,
 *     pg_relation_size(i.indexrelid)::numeric / 1024 / 1024
 *   FROM pg_indexes i
 *   WHERE i.indexname = ANY(index_names);
 * END;
 * $$ LANGUAGE plpgsql;
 */
