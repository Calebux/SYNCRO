import { addDays } from 'date-fns';
import type { Subscription } from "@/lib/supabase/subscriptions";

export function detectDuplicates(subscriptions: Subscription[]) {
    const duplicates: any[] = [];
    const subscriptionNames: Record<string, Subscription[]> = {};

    subscriptions.forEach((sub) => {
        const name = sub.name.toLowerCase();
        if (!subscriptionNames[name]) {
            subscriptionNames[name] = [];
        }
        subscriptionNames[name].push(sub);
    });

    Object.entries(subscriptionNames).forEach(([name, subs]) => {
        if (subs.length > 1) {
            const totalCost = subs.reduce((sum, s) => sum + s.price, 0);
            const potentialSavings = totalCost - subs[0].price;
            duplicates.push({
                name: subs[0].name,
                count: subs.length,
                subscriptions: subs,
                totalCost,
                potentialSavings,
            });
        }
    });

    return duplicates;
}

export function detectUnusedSubscriptions(subscriptions: Subscription[]) {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    return subscriptions
        .filter((sub) => {
            if (sub.status !== "active") return false;
            // Flag if last_interaction_at is null or older than 3 months
            const lastInteraction = (sub as any).last_interaction_at;
            if (!lastInteraction) return true;
            return new Date(lastInteraction) < threeMonthsAgo;
        })
        .map((sub) => {
            const lastInteraction = (sub as any).last_interaction_at;
            const daysSinceInteraction = lastInteraction
                ? Math.floor((now.getTime() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60 * 24))
                : null;
            return {
                ...sub,
                potentiallyWasted: true,
                daysSinceInteraction,
            };
        });
}

export function getTrialSubscriptions(subscriptions: Subscription[]) {
    return subscriptions.filter((sub) => sub.is_trial);
}

export function getCancelledSubscriptions(subscriptions: Subscription[]) {
    return subscriptions.filter((sub) => sub.status === "cancelled");
}

export function getPausedSubscriptions(subscriptions: Subscription[]) {
    return subscriptions.filter((sub) => sub.status === "paused");
}

export function checkDuplicate(subscriptions: Subscription[], name: string) {
    return subscriptions.some(
        (sub) => sub.name.toLowerCase() === name.toLowerCase()
    );
}

export function calculateRecurringSpend(subscriptions: Subscription[]) {
    return subscriptions
        .filter(
            (sub) => sub.billing_cycle !== "lifetime" && sub.status === "active"
        )
        .reduce((sum, sub) => sum + sub.price, 0);
}

export function calculateTotalSpend(subscriptions: Subscription[]) {
    return subscriptions
        .filter((sub) => sub.status === "active" || sub.status === "cancelled")
        .reduce((sum, sub) => {
            if (sub.billing_cycle === "lifetime") {
                return sum;
            }
            return sum + sub.price;
        }, 0);
}

export function checkRenewalReminders(subscriptions: Subscription[]) {
    return subscriptions
        .filter((sub) => {
            if (sub.status !== "active") return false;
            const daysUntilRenewal = sub.renews_in || 0;
            return daysUntilRenewal <= 3 && daysUntilRenewal >= 0;
        })
        .map((sub) => ({
            id: sub.id,
            name: sub.name,
            price: sub.price,
            renewsIn: sub.renews_in || 0,
            renewalDate: addDays(new Date(), sub.renews_in || 0),
        }));
}
