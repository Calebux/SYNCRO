import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { AppClient } from "@/components/app/app-client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

// Helper to transform DB subscription (snake_case) to app format (camelCase)
function transformSubscription(dbSub: any): any {
    return {
        id: dbSub.id,
        name: dbSub.name,
        category: dbSub.category,
        price: dbSub.price,
        icon: dbSub.icon || "🔗",
        renewsIn: dbSub.renews_in,
        status: dbSub.status,
        color: dbSub.color || "#000000",
        renewalUrl: dbSub.renewal_url,
        tags: dbSub.tags || [],
        dateAdded: dbSub.date_added,
        emailAccountId: dbSub.email_account_id,
        lastUsedAt: dbSub.last_used_at,
        hasApiKey: dbSub.has_api_key || false,
        isTrial: dbSub.is_trial || false,
        trialEndsAt: dbSub.trial_ends_at,
        priceAfterTrial: dbSub.price_after_trial,
        source: dbSub.source || "manual",
        manuallyEdited: dbSub.manually_edited || false,
        editedFields: dbSub.edited_fields || [],
        pricingType: dbSub.pricing_type || "fixed",
        billingCycle: dbSub.billing_cycle || "monthly",
        cancelledAt: dbSub.cancelled_at,
        activeUntil: dbSub.active_until,
        pausedAt: dbSub.paused_at,
        resumesAt: dbSub.resumes_at,
        priceRange: dbSub.price_range,
        priceHistory: dbSub.price_history,
    };
}

async function getInitialData() {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            // Not authenticated - return empty data
            return {
                subscriptions: [],
                emailAccounts: [],
                priceChanges: [],
                consolidationSuggestions: [],
            };
        }

        // Fetch real data from database
        const [subscriptionsResult, emailAccountsResult] = await Promise.all([
            supabase
                .from("subscriptions")
                .select("*")
                .eq("user_id", user.id)
                .order("date_added", { ascending: false }),
            supabase.from("email_accounts").select("*").eq("user_id", user.id),
        ]);

        const subscriptions =
            subscriptionsResult.data?.map(transformSubscription) || [];
        const emailAccounts = emailAccountsResult.data || [];

        return {
            subscriptions,
            emailAccounts,
            priceChanges: [], // TODO: Fetch from database
            consolidationSuggestions: [], // TODO: Fetch from database
        };
    } catch (error) {
        console.error("Error fetching initial data:", error);
        // Fallback to empty data on error
        return {
            subscriptions: [],
            emailAccounts: [],
            priceChanges: [],
            consolidationSuggestions: [],
        };
    }
}

export default async function HomePage() {
    const initialData = await getInitialData();

    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-[#F9F6F2] dark:bg-[#1E2A35] flex items-center justify-center">
                    <LoadingSpinner size="lg" darkMode={false} />
                </div>
            }
        >
            <AppClient
                initialSubscriptions={initialData.subscriptions}
                initialEmailAccounts={initialData.emailAccounts}
                initialPriceChanges={initialData.priceChanges}
                initialConsolidationSuggestions={
                    initialData.consolidationSuggestions
                }
            />
        </Suspense>
    );
}
