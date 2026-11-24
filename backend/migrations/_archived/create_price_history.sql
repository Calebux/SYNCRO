-- Create subscription_price_history table
CREATE TABLE IF NOT EXISTS subscription_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  old_price DECIMAL(10, 2) NOT NULL,
  new_price DECIMAL(10, 2) NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE subscription_price_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own price history"
  ON subscription_price_history FOR SELECT
  USING (auth.uid() = user_id);

-- Function to handle price changes
CREATE OR REPLACE FUNCTION handle_subscription_price_change()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.price IS DISTINCT FROM NEW.price) THEN
    INSERT INTO subscription_price_history (subscription_id, old_price, new_price, user_id)
    VALUES (NEW.id, OLD.price, NEW.price, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for price changes
DROP TRIGGER IF EXISTS on_subscription_price_change ON subscriptions;
CREATE TRIGGER on_subscription_price_change
  AFTER UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION handle_subscription_price_change();
