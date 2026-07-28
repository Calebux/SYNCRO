-- Migration: Telegram integration token encryption at rest
-- Issue #1076: encrypt OAuth/integration tokens at rest
--
-- Creates the user_telegram_connections table (if not already present from a
-- previous manual deploy) and ensures the bot_token column that stores the
-- per-user Telegram bot token is persisted in encrypted form only.
-- The access_token column stores the encrypted OAuth bearer token for
-- future OAuth-based Telegram integrations.
--
-- Encryption: AES-256-GCM via backend/src/utils/encryption.ts (same scheme
-- used for Gmail/Outlook tokens).  Plaintext values are NEVER written to disk.

CREATE TABLE IF NOT EXISTS public.user_telegram_connections (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chat_id      TEXT         NOT NULL,
    username     TEXT,
    first_name   TEXT,
    last_name    TEXT,
    -- AES-256-GCM encrypted token (format: iv:tag:ciphertext).
    -- Populated when a user connects via OAuth or a bot token flow.
    -- NULL when the connection was made via deep-link only (no token needed).
    access_token TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (user_id),
    UNIQUE (chat_id)
);

-- RLS: users may only see/modify their own row.
ALTER TABLE public.user_telegram_connections ENABLE ROW LEVEL SECURITY;

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

-- Indexes for the hot lookup paths used by the webhook and notification service.
CREATE INDEX IF NOT EXISTS idx_telegram_connections_user_id
    ON public.user_telegram_connections (user_id);

CREATE INDEX IF NOT EXISTS idx_telegram_connections_chat_id
    ON public.user_telegram_connections (chat_id);
