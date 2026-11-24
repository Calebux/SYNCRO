-- Deterministic local seed for development and E2E bootstraps.
-- The inserts are guarded so the seed can run against partially provisioned
-- local databases without aborting the entire reset.

-- Stable UUIDs so foreign keys stay consistent across reset runs.
-- user-1: primary owner
-- user-2: secondary collaborator / notification recipient

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users table not available, skipping auth seed.';
    RETURN;
  END IF;

  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_sent_at,
    confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES
    (
      '11111111-1111-1111-1111-111111111111',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'demo@synchro.app',
      '$2a$10$7EqJtq98hPqEX7fNZaFWoOe7N3K0wqf8N0bQ2o8QwqjYv0q1WmK0S',
      now(),
      now(),
      now(),
      NULL,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo User","timezone":"UTC","currency":"USD"}'::jsonb,
      now(),
      now()
    ),
    (
      '22222222-2222-2222-2222-222222222222',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'teammate@synchro.app',
      '$2a$10$7EqJtq98hPqEX7fNZaFWoOe7N3K0wqf8N0bQ2o8QwqjYv0q1WmK0S',
      now(),
      now(),
      now(),
      NULL,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Teammate","timezone":"UTC","currency":"USD"}'::jsonb,
      now(),
      now()
    )
  ON CONFLICT (id) DO NOTHING;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_preferences') IS NULL THEN
    RAISE NOTICE 'user_preferences table not available, skipping preferences seed.';
    RETURN;
  END IF;

  INSERT INTO public.user_preferences (
    user_id,
    notification_channels,
    reminder_timing,
    email_opt_ins,
    automation_flags,
    created_at,
    updated_at
  )
  VALUES
    (
      '11111111-1111-1111-1111-111111111111',
      ARRAY['email', 'push', 'slack'],
      ARRAY[7, 3, 1],
      '{"marketing": false, "reminders": true, "updates": true}'::jsonb,
      '{"auto_renew": false, "auto_retry": true}'::jsonb,
      now(),
      now()
    ),
    (
      '22222222-2222-2222-2222-222222222222',
      ARRAY['slack'],
      ARRAY[14, 7, 3],
      '{"marketing": false, "reminders": true, "updates": false}'::jsonb,
      '{"auto_renew": false, "auto_retry": true}'::jsonb,
      now(),
      now()
    )
  ON CONFLICT (user_id) DO NOTHING;
END $$;

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RAISE NOTICE 'subscriptions table not available, skipping subscription seed.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.subscriptions (
      id,
      user_id,
      name,
      provider,
      category,
      price,
      billing_cycle,
      currency,
      status,
      next_billing_date,
      renewal_url,
      website_url,
      notes,
      tags,
      active_until,
      is_trial,
      trial_ends_at,
      trial_converts_to_price,
      credit_card_required,
      created_at,
      updated_at
    )
    VALUES
      (
        '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        'Netflix',
        'Netflix',
        'Streaming',
        15.99,
        'monthly',
        'USD',
        'active',
        date_trunc('day', now()) + interval '15 days',
        'https://netflix.com/account',
        'https://netflix.com',
        'Seeded Netflix subscription',
        ARRAY['entertainment', 'streaming'],
        date_trunc('day', now()) + interval '15 days',
        false,
        NULL,
        NULL,
        false,
        now(),
        now()
      ),
      (
        '44444444-4444-4444-4444-444444444444',
        '11111111-1111-1111-1111-111111111111',
        'Slack',
        'Slack',
        'Productivity',
        7.00,
        'monthly',
        'USD',
        'trial',
        date_trunc('day', now()) + interval '7 days',
        'https://slack.com/account/billing',
        'https://slack.com',
        'Seeded Slack trial',
        ARRAY['work', 'collaboration'],
        date_trunc('day', now()) + interval '7 days',
        true,
        date_trunc('day', now()) + interval '7 days',
        7.00,
        true,
        now(),
        now()
      )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN undefined_column OR undefined_table THEN
      RAISE NOTICE 'subscriptions table schema does not match this seed, skipping subscriptions.';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.reminder_schedules') IS NULL THEN
    RAISE NOTICE 'reminder_schedules table not available, skipping reminder seed.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.reminder_schedules (
      id,
      subscription_id,
      user_id,
      reminder_date,
      reminder_type,
      days_before,
      status,
      created_at,
      updated_at
    )
    VALUES
      (
        '55555555-5555-5555-5555-555555555555',
        '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        (date_trunc('day', now()) + interval '8 days')::date,
        'renewal',
        7,
        'pending',
        now(),
        now()
      ),
      (
        '66666666-6666-6666-6666-666666666666',
        '44444444-4444-4444-4444-444444444444',
        '11111111-1111-1111-1111-111111111111',
        (date_trunc('day', now()) + interval '7 days')::date,
        'trial_expiry',
        7,
        'pending',
        now(),
        now()
      )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN foreign_key_violation OR undefined_column OR undefined_table THEN
      RAISE NOTICE 'reminder_schedules seed skipped because subscriptions data is unavailable.';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE NOTICE 'notification_deliveries table not available, skipping delivery seed.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.notification_deliveries (
      id,
      reminder_schedule_id,
      user_id,
      channel,
      status,
      attempt_count,
      max_attempts,
      last_attempt_at,
      next_retry_at,
      error_message,
      metadata,
      created_at,
      updated_at
    )
    VALUES
      (
        '77777777-7777-7777-7777-777777777777',
        '55555555-5555-5555-5555-555555555555',
        '11111111-1111-1111-1111-111111111111',
        'slack',
        'sent',
        1,
        3,
        now(),
        NULL,
        NULL,
        '{"transport":"slack-webhook"}'::jsonb,
        now(),
        now()
      )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN foreign_key_violation OR undefined_column OR undefined_table THEN
      RAISE NOTICE 'notification_deliveries seed skipped because reminder data is unavailable.';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      id,
      user_id,
      action,
      resource_type,
      resource_id,
      metadata,
      ip_address,
      user_agent,
      created_at
    )
    VALUES
      (
        '88888888-8888-8888-8888-888888888888',
        '11111111-1111-1111-1111-111111111111',
        'seeded_login',
        'account',
        '11111111-1111-1111-1111-111111111111',
        '{"source":"seed"}'::jsonb,
        '127.0.0.1',
        'seed-script',
        now()
      )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.digest_audit_log') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.digest_audit_log (
        id,
        user_id,
        digest_type,
        period_label,
        status,
        error_message,
        sent_at
      )
      VALUES
        (
          '99999999-9999-9999-9999-999999999999',
          '11111111-1111-1111-1111-111111111111',
          'monthly',
          'March 2026',
          'sent',
          NULL,
          now() - interval '1 day'
        )
      ON CONFLICT (id) DO NOTHING;
    EXCEPTION
      WHEN undefined_column OR undefined_table THEN
        RAISE NOTICE 'digest_audit_log schema does not match this seed, skipping digest analytics.';
    END;
  END IF;
END $$;
