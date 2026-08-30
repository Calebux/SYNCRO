
-- Add encrypted metadata columns to subscriptions table
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS encrypted_name TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_price TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_category TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_renewal_url TEXT,
  ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT false;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_is_encrypted ON public.subscriptions(is_encrypted);
