-- Create an RPC to fetch subscription metrics efficiently without full table scan in application layer
CREATE OR REPLACE FUNCTION get_subscription_metrics()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_subscriptions', COUNT(*),
        'active_subscriptions', COUNT(*) FILTER (WHERE status = 'active'),
        'category_distribution', (
            SELECT json_object_agg(category, cat_count)
            FROM (
                SELECT category, COUNT(*) as cat_count
                FROM subscriptions
                GROUP BY category
            ) c
        ),
        'total_monthly_revenue', COALESCE(
            SUM(
                CASE 
                    WHEN status = 'active' AND billing_cycle = 'yearly' THEN price / 12
                    WHEN status = 'active' AND billing_cycle = 'weekly' THEN price * 4
                    WHEN status = 'active' THEN price
                    ELSE 0
                END
            ), 0
        )
    ) INTO result
    FROM subscriptions;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
