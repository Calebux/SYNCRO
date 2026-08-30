import { formatCurrency } from "./currency-utils"

export interface BudgetAlert {
    level: "critical" | "warning";
    message: string;
    percentage: string;
}

export function checkBudgetAlerts(
    totalSpend: number,
    budgetLimit: number,
    currency: string = "USD"
): BudgetAlert | null {
    const percentage = (totalSpend / budgetLimit) * 100;

    if (percentage >= 100) {
        return {
            level: "critical",
            message: `You've exceeded your ${formatCurrency(budgetLimit, currency)} budget by ${formatCurrency(totalSpend - budgetLimit, currency)}`,
            percentage: percentage.toFixed(0),
        };
    } else if (percentage >= 80) {
        return {
            level: "warning",
            message: `You've used ${percentage.toFixed(
                0
            )}% of your ${formatCurrency(budgetLimit, currency)} budget`,
            percentage: percentage.toFixed(0),
        };
    }

    return null;
}

/** Returns true + overage if adding `newMonthlyAmount` would exceed the budget. */
export function wouldExceedBudget(
    currentTotal: number,
    newMonthlyAmount: number,
    budgetLimit: number
): { exceeds: boolean; newTotal: number; overage: number } {
    const newTotal = currentTotal + newMonthlyAmount;
    return {
        exceeds: newTotal > budgetLimit,
        newTotal,
        overage: Math.max(0, newTotal - budgetLimit),
    };
}

/** Annual projection message. */
export function annualProjection(
    monthlyTotal: number,
    annualBudget: number,
    currency: string = "USD"
): string | null {
    const projected = monthlyTotal * 12;
    if (projected <= annualBudget) return null;
    return `At your current rate, you'll spend ${formatCurrency(projected, currency)} on subscriptions this year — ${formatCurrency(projected - annualBudget, currency)} over your ${formatCurrency(annualBudget, currency)} annual budget.`;
}
