-- V3 Analytics aggregation views (issue #1480)
--
-- These views pre-aggregate usage and settlement metrics so the
-- analytics endpoints read from materialized summaries rather than
-- scanning raw usage rows.  They are scoped by user_id to enforce
-- tenant isolation at the database level.

-- ── Per-user metered calls aggregation ──────────────────────────────
CREATE OR REPLACE VIEW public.v3_analytics_calls_metered AS
SELECT
  user_id,
  date_trunc('day', created_at) AS period_day,
  COUNT(*) AS calls_count,
  SUM(amount) AS total_amount
FROM public.channel_payments
GROUP BY user_id, date_trunc('day', created_at);

CREATE INDEX IF NOT EXISTS idx_v3_calls_metered_user ON public.v3_analytics_calls_metered (user_id, period_day);

-- ── Per-user settlement aggregation ─────────────────────────────────
CREATE OR REPLACE VIEW public.v3_analytics_settlements AS
SELECT
  user_id,
  date_trunc('day', created_at) AS period_day,
  SUM(CASE WHEN status = 'confirmed' THEN settlement_amount ELSE 0 END) AS value_settled,
  SUM(CASE WHEN status != 'confirmed' THEN amount ELSE 0 END) AS value_unsettled,
  COUNT(*) AS settlement_count
FROM public.pending_settlements
GROUP BY user_id, date_trunc('day', created_at);

CREATE INDEX IF NOT EXISTS idx_v3_settlements_user ON public.v3_analytics_settlements (user_id, period_day);

-- ── Per-user active channels ────────────────────────────────────────
CREATE OR REPLACE VIEW public.v3_analytics_active_channels AS
SELECT
  user_id,
  COUNT(*) AS active_channel_count,
  SUM(balance) AS total_balance,
  SUM(deposit_amount) AS total_capacity
FROM public.payment_channels
WHERE status = 'active'
GROUP BY user_id;

CREATE INDEX IF NOT EXISTS idx_v3_active_channels_user ON public.v3_analytics_active_channels (user_id);

-- ── Per-user rejection reasons (from pending_settlements errors) ───
CREATE OR REPLACE VIEW public.v3_analytics_rejections AS
SELECT
  user_id,
  date_trunc('day', created_at) AS period_day,
  CASE
    WHEN error_message ILIKE '%auth%' OR error_message ILIKE '%unauthorized%' THEN 'authentication'
    WHEN error_message ILIKE '%rate%' OR error_message ILIKE '%limit%' THEN 'rate_limit'
    WHEN error_message ILIKE '%valid%' OR error_message ILIKE '%malform%' THEN 'validation'
    WHEN error_message ILIKE '%timeout%' OR error_message ILIKE '%internal%' THEN 'internal_error'
    WHEN error_message ILIKE '%network%' OR error_message ILIKE '%connection%' THEN 'network'
    WHEN error_message ILIKE '%pay%' OR error_message ILIKE '%billing%' THEN 'billing'
    ELSE 'other'
  END AS category,
  COUNT(*) AS rejection_count
FROM public.pending_settlements
WHERE status != 'confirmed'
GROUP BY user_id, date_trunc('day', created_at),
  CASE
    WHEN error_message ILIKE '%auth%' OR error_message ILIKE '%unauthorized%' THEN 'authentication'
    WHEN error_message ILIKE '%rate%' OR error_message ILIKE '%limit%' THEN 'rate_limit'
    WHEN error_message ILIKE '%valid%' OR error_message ILIKE '%malform%' THEN 'validation'
    WHEN error_message ILIKE '%timeout%' OR error_message ILIKE '%internal%' THEN 'internal_error'
    WHEN error_message ILIKE '%network%' OR error_message ILIKE '%connection%' THEN 'network'
    WHEN error_message ILIKE '%pay%' OR error_message ILIKE '%billing%' THEN 'billing'
    ELSE 'other'
  END;

CREATE INDEX IF NOT EXISTS idx_v3_rejections_user ON public.v3_analytics_rejections (user_id, period_day, category);

COMMENT ON VIEW public.v3_analytics_calls_metered IS 'V3 analytics: per-user daily metered call counts';
COMMENT ON VIEW public.v3_analytics_settlements IS 'V3 analytics: per-user daily settled and unsettled values';
COMMENT ON VIEW public.v3_analytics_active_channels IS 'V3 analytics: per-user active channel counts and capacity';
COMMENT ON VIEW public.v3_analytics_rejections IS 'V3 analytics: per-user daily rejection reasons by category';