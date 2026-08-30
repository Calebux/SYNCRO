-- Migration: Create user_telegram_connections table for Telegram bot integration
-- This enables the Telegram bot service to send notifications to users who have connected their accounts

CREATE TABLE IF NOT EXISTS public.user_telegram_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.user_telegram_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "telegram_connections_select_own"
  ON public.user_telegram_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "telegram_connections_insert_own"
  ON public.user_telegram_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "telegram_connections_update_own"
  ON public.user_telegram_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "telegram_connections_delete_own"
  ON public.user_telegram_connections FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS telegram_connections_user_id_idx
  ON public.user_telegram_connections(user_id);

CREATE INDEX IF NOT EXISTS telegram_connections_chat_id_idx
  ON public.user_telegram_connections(chat_id);

CREATE INDEX IF NOT EXISTS telegram_connections_connected_at_idx
  ON public.user_telegram_connections(connected_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_telegram_connection_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_telegram_connections_updated_at
  BEFORE UPDATE ON public.user_telegram_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_telegram_connection_updated_at();

COMMENT ON TABLE public.user_telegram_connections IS
  'Telegram bot connections for delivering renewal reminders and notifications to users via Telegram';
