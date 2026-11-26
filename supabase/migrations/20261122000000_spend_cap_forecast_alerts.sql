-- #1856: forecast alerts reuse spend_cap_alert_logs for deduplication.
-- threshold 0 denotes the "projected exhaustion inside window" forecast alert.
ALTER TABLE public.spend_cap_alert_logs
  DROP CONSTRAINT IF EXISTS spend_cap_alert_logs_threshold_check;

ALTER TABLE public.spend_cap_alert_logs
  ADD CONSTRAINT spend_cap_alert_logs_threshold_check
  CHECK (threshold IN (0, 80, 100));
