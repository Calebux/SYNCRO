-- Create cancellation_guides table
CREATE TABLE IF NOT EXISTS cancellation_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL UNIQUE,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  direct_url TEXT NOT NULL,
  steps TEXT[] NOT NULL,
  estimated_time TEXT NOT NULL,
  warning_note TEXT,
  chat_support_link TEXT,
  phone_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create cancellation_difficulty_reports table for community contribution
CREATE TABLE IF NOT EXISTS cancellation_difficulty_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  reported_difficulty TEXT NOT NULL CHECK (reported_difficulty IN ('easy', 'medium', 'hard')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_cancellation_guides_service_name ON cancellation_guides(service_name);
CREATE INDEX idx_difficulty_reports_service_name ON cancellation_difficulty_reports(service_name);

-- Add updated_at trigger for cancellation_guides
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_cancellation_guides_updated_at
    BEFORE UPDATE ON cancellation_guides
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
