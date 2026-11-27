/**
 * Test script for CSP monitoring functionality
 * 
 * This script tests the CSP monitoring service without requiring
 * a full server setup. It's useful for verifying the implementation
 * works correctly.
 * 
 * Usage: node test-csp-monitoring.js
 */

const { supabase } = require('./src/config/database');

async function testCspMonitoring() {
    console.log('🧪 Testing CSP Monitoring Implementation\n');

    // Test 1: Check if table exists
    console.log('1️⃣  Checking if csp_violations table exists...');
    try {
        const { data, error } = await supabase
            .from('csp_violations')
            .select('id')
            .limit(1);

        if (error) {
            console.error('❌ Table does not exist or is not accessible:', error.message);
            console.log('   Run migration: npm run db:migrate\n');
            return false;
        }
        console.log('✅ Table exists and is accessible\n');
    } catch (error) {
        console.error('❌ Error checking table:', error.message, '\n');
        return false;
    }

    // Test 2: Check if materialized view exists
    console.log('2️⃣  Checking if csp_violation_stats view exists...');
    try {
        const { data, error } = await supabase
            .from('csp_violation_stats')
            .select('violation_signature')
            .limit(1);

        if (error) {
            console.error('❌ View does not exist or is not accessible:', error.message);
            console.log('   Run migration: npm run db:migrate\n');
            return false;
        }
        console.log('✅ View exists and is accessible\n');
    } catch (error) {
        console.error('❌ Error checking view:', error.message, '\n');
        return false;
    }

    // Test 3: Insert a test violation
    console.log('3️⃣  Inserting test violation...');
    try {
        const testViolation = {
            document_uri: 'https://example.com/test',
            violated_directive: 'script-src',
            blocked_uri: 'https://test.com/script.js',
            source_file: 'https://example.com/test',
            line_number: 42,
            column_number: 10,
            disposition: 'report',
            user_agent: 'Test User Agent',
            ip_address: '127.0.0.1',
        };

        const { data, error } = await supabase
            .from('csp_violations')
            .insert(testViolation)
            .select();

        if (error) {
            console.error('❌ Failed to insert test violation:', error.message, '\n');
            return false;
        }
        console.log('✅ Test violation inserted successfully');
        console.log('   ID:', data[0].id, '\n');
    } catch (error) {
        console.error('❌ Error inserting violation:', error.message, '\n');
        return false;
    }

    // Test 4: Query violations
    console.log('4️⃣  Querying recent violations...');
    try {
        const { data, error } = await supabase
            .from('csp_violations')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error('❌ Failed to query violations:', error.message, '\n');
            return false;
        }
        console.log('✅ Found', data.length, 'recent violations');
        if (data.length > 0) {
            console.log('   Latest:', {
                directive: data[0].violated_directive,
                blocked_uri: data[0].blocked_uri,
                created_at: data[0].created_at,
            });
        }
        console.log('');
    } catch (error) {
        console.error('❌ Error querying violations:', error.message, '\n');
        return false;
    }

    // Test 5: Check refresh function
    console.log('5️⃣  Testing stats refresh function...');
    try {
        const { error } = await supabase.rpc('refresh_csp_violation_stats');

        if (error) {
            console.error('❌ Failed to refresh stats:', error.message, '\n');
            return false;
        }
        console.log('✅ Stats refresh function works\n');
    } catch (error) {
        console.error('❌ Error refreshing stats:', error.message, '\n');
        return false;
    }

    // Test 6: Query stats
    console.log('6️⃣  Querying violation statistics...');
    try {
        const { data, error } = await supabase
            .from('csp_violation_stats')
            .select('*')
            .order('occurrence_count', { ascending: false })
            .limit(5);

        if (error) {
            console.error('❌ Failed to query stats:', error.message, '\n');
            return false;
        }
        console.log('✅ Found', data.length, 'violation types');
        if (data.length > 0) {
            console.log('   Top violation:', {
                directive: data[0].violated_directive,
                blocked_uri: data[0].blocked_uri,
                count: data[0].occurrence_count,
                affected_users: data[0].affected_users,
            });
        }
        console.log('');
    } catch (error) {
        console.error('❌ Error querying stats:', error.message, '\n');
        return false;
    }

    console.log('✅ All tests passed!\n');
    console.log('📊 Summary:');
    console.log('   - Database table: ✅');
    console.log('   - Materialized view: ✅');
    console.log('   - Insert violations: ✅');
    console.log('   - Query violations: ✅');
    console.log('   - Refresh stats: ✅');
    console.log('   - Query stats: ✅');
    console.log('');
    console.log('🎉 CSP monitoring is ready to use!');
    console.log('');
    console.log('Next steps:');
    console.log('   1. Set environment variables (CSP_MONITORING_ENABLED, etc.)');
    console.log('   2. Start the backend server');
    console.log('   3. Trigger a CSP violation in the browser');
    console.log('   4. Check Sentry for alerts');
    console.log('   5. Query the API for statistics');
    console.log('');

    return true;
}

// Run tests
testCspMonitoring()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error('💥 Unexpected error:', error);
        process.exit(1);
    });
