-- Add visibility column to subscriptions table
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private' 
CHECK (visibility IN ('private', 'team'));

-- Create index for visibility filtering
CREATE INDEX IF NOT EXISTS subscriptions_visibility_idx ON public.subscriptions(visibility);

-- Update RLS policies to allow team members to see 'team' visible subscriptions
-- Assuming there's a team_members table that links users and teams

-- Policy for viewing subscriptions:
-- 1. Owner can view everything
-- 2. Team members can view subscriptions with visibility = 'team' if they share a team with the owner
CREATE POLICY "Users can view team-visible subscriptions"
  ON public.subscriptions FOR SELECT
  USING (
    auth.uid() = user_id OR 
    (visibility = 'team' AND EXISTS (
      SELECT 1 FROM public.team_members tm1
      JOIN public.team_members tm2 ON tm1.team_id = tm2.team_id
      WHERE tm1.user_id = auth.uid() AND tm2.user_id = subscriptions.user_id
    ))
  );
