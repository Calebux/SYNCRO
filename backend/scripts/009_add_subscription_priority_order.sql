-- Personal subscription priority order (drag-and-drop reordering)
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS subscription_priority_order uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.user_preferences.subscription_priority_order IS
  'Ordered subscription IDs reflecting the user''s personal priority ranking';
