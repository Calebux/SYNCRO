/**
 * scripts/reconcile-stripe-payments.js
 * 
 * Operational tool for reconciling payments between the local database and Stripe.
 * Useful for recovering from webhook delivery failures or outages.
 * 
 * Usage:
 *   node scripts/reconcile-stripe-payments.js --status pending --age 24h
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_LIVE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

async function reconcile(options = {}) {
  const { 
    supabaseClient = supabase, 
    stripeClient = stripe,
    logger = console 
  } = options;

  logger.log('--- Starting Stripe Reconciliation ---');
  
  // 1. Fetch pending payments from Supabase
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  const { data: payments, error } = await supabaseClient
    .from('payments')
    .select('*')
    .eq('status', 'pending')
    .eq('provider', 'stripe')
    .lt('created_at', fiveMinutesAgo);

  if (error) {
    logger.error('Failed to fetch pending payments:', error);
    return;
  }

  logger.log(`Found ${payments.length} pending Stripe payments older than 5 minutes.`);

  for (const payment of payments) {
    if (!payment.transaction_id) {
      logger.warn(`Payment ${payment.id} is missing transaction_id. Skipping.`);
      continue;
    }

    try {
      // 2. Query Stripe for the actual status
      const pi = await stripeClient.paymentIntents.retrieve(payment.transaction_id);
      
      logger.log(`Checking PI ${pi.id}: Stripe status is "${pi.status}", DB status is "${payment.status}"`);

      if (pi.status === 'succeeded' && payment.status !== 'succeeded') {
        // 3. Update Supabase if Stripe says it succeeded
        const { error: updateErr } = await supabaseClient
          .from('payments')
          .update({ 
            status: 'succeeded',
            updated_at: new Date().toISOString()
          })
          .eq('id', payment.id);

        if (updateErr) {
          logger.error(`Failed to update payment ${payment.id}:`, updateErr);
        } else {
          logger.log(`✅ Reconciled payment ${payment.id} -> succeeded`);
          
          // 4. Also update profile tier if metadata exists (mimicking webhook logic)
          if (pi.metadata?.userId && pi.metadata?.planName) {
            const { error: profileErr } = await supabaseClient
              .from('profiles')
              .update({ subscription_tier: pi.metadata.planName })
              .eq('id', pi.metadata.userId);
            
            if (profileErr) {
              logger.error(`Failed to update profile for user ${pi.metadata.userId}:`, profileErr);
            } else {
              logger.log(`✅ Updated profile tier for user ${pi.metadata.userId} to "${pi.metadata.planName}"`);
            }
          }
        }
      } else if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
        // Mark as failed in DB if Stripe says it failed/canceled
        await supabaseClient
          .from('payments')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', payment.id);
        logger.log(`❌ Marked payment ${payment.id} as failed (Stripe status: ${pi.status})`);
      } else {
        logger.log(`- Payment ${payment.id} still ${pi.status}. No action taken.`);
      }
    } catch (err) {
      logger.error(`Error retrieving PI ${payment.transaction_id}:`, err.message);
    }
  }

  logger.log('--- Reconciliation Finished ---');
}

module.exports = { reconcile };

if (require.main === module) {
  reconcile();
}
