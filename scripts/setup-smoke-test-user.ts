/**
 * Setup Smoke Test User
 * 
 * Creates or verifies the smoke test user exists in the database
 * This should be run once per environment (staging/production)
 * 
 * Usage:
 *   npx ts-node scripts/setup-smoke-test-user.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_USER_EMAIL = process.env.SMOKE_TEST_USER_EMAIL || 'smoke-test@syncro.test';
const TEST_USER_PASSWORD = process.env.SMOKE_TEST_USER_PASSWORD || 'TestPassword123!';

async function setupSmokeTestUser() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   - SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('🔧 Setting up smoke test user...');
  console.log(`   Email: ${TEST_USER_EMAIL}`);
  console.log(`   Supabase URL: ${SUPABASE_URL}`);
  console.log('');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    // Check if user already exists
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Error listing users:', listError.message);
      process.exit(1);
    }

    const existingUser = existingUsers.users.find(u => u.email === TEST_USER_EMAIL);

    if (existingUser) {
      console.log('✅ Smoke test user already exists');
      console.log(`   User ID: ${existingUser.id}`);
      console.log(`   Created: ${existingUser.created_at}`);
      
      // Verify profile exists
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', existingUser.id)
        .single();

      if (profileError || !profile) {
        console.log('⚠️  Profile missing, creating...');
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: existingUser.id,
            email: TEST_USER_EMAIL,
            role: 'member',
          });

        if (insertError) {
          console.error('❌ Error creating profile:', insertError.message);
        } else {
          console.log('✅ Profile created');
        }
      } else {
        console.log('✅ Profile exists');
      }

      return;
    }

    // Create new user
    console.log('📝 Creating new smoke test user...');
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: 'member',
        created_by: 'smoke-test-setup',
      },
    });

    if (createError) {
      console.error('❌ Error creating user:', createError.message);
      process.exit(1);
    }

    console.log('✅ User created successfully');
    console.log(`   User ID: ${newUser.user.id}`);

    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: newUser.user.id,
        email: TEST_USER_EMAIL,
        role: 'member',
      });

    if (profileError) {
      console.error('⚠️  Error creating profile:', profileError.message);
      console.log('   Profile may be created automatically by trigger');
    } else {
      console.log('✅ Profile created');
    }

    // Create a sample subscription for testing
    console.log('📝 Creating sample subscription...');
    const { error: subError } = await supabase
      .from('subscriptions')
      .insert({
        user_id: newUser.user.id,
        name: 'Smoke Test Subscription',
        price: 9.99,
        currency: 'USD',
        billing_cycle: 'monthly',
        next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'active',
        category: 'testing',
      });

    if (subError) {
      console.error('⚠️  Error creating sample subscription:', subError.message);
    } else {
      console.log('✅ Sample subscription created');
    }

    console.log('');
    console.log('🎉 Smoke test user setup complete!');
    console.log('');
    console.log('Add these to your CI/CD secrets:');
    console.log(`   SMOKE_TEST_USER_EMAIL=${TEST_USER_EMAIL}`);
    console.log(`   SMOKE_TEST_USER_PASSWORD=${TEST_USER_PASSWORD}`);

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

setupSmokeTestUser();
