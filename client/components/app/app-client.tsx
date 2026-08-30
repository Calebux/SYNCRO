"use client";

import { useState, useEffect, Suspense, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import WelcomePage from "@/components/pages/welcome";
import EnterpriseSetup from "@/components/pages/enterprise-setup";
import DashboardPage from "@/components/pages/dashboard";
import LandingAuth from "@/components/pages/landing-auth";
import SubscriptionsPage from "@/components/pages/subscriptions";
import IntegrationsPage from "@/components/pages/integrations";
import SettingsPage from "@/components/pages/settings";
import TeamsPage from "@/components/pages/teams";
import OnboardingModal from "@/components/modals/onboarding-modal";
import AddSubscriptionModal from "@/components/modals/add-subscription-modal";
import UpgradePlanModal from "@/components/modals/upgrade-plan-modal";
import NotificationsPanel from "@/components/notifications-panel";
import ManageSubscriptionModal from "@/components/modals/manage-subscription-modal";
import InsightsModal from "@/components/modals/insights-modal";
import InsightsPage from "@/components/pages/insights";
import EditSubscriptionModal from "@/components/modals/edit-subscription-modal";
import { useOnboardingTourEnhanced } from "@/components/onboarding-tour-state";
import { Toast, ToastContainer } from "@/components/ui/toast";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AppLayout } from "@/components/layout/app-layout";
import type { Subscription as DBSubscription } from "@/lib/supabase/subscriptions";
import { createSubscription } from "@/lib/supabase/subscriptions";
import { isOnline } from "@/lib/network-utils";
import type { Currency } from "@/lib/currency-utils";
import type { DetectedSubscription } from "@/lib/notification-types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useConfirmationDialog } from "@/hooks/use-confirmation-dialog";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { useBulkActions } from "@/hooks/use-bulk-actions";
import { useEmailAccounts } from "@/hooks/use-email-accounts";
import { useNotifications } from "@/hooks/use-notifications";
import { useNotificationActions } from "@/hooks/use-notification-actions";
import { UndoProvider, useUndoContext } from "@/components/providers/undo-context";
import UndoPanel from "@/components/undo-panel";
import {
    checkRenewalReminders,
    detectDuplicates,
    detectUnusedSubscriptions,
    getTrialSubscriptions,
    getCancelledSubscriptions,
    getPausedSubscriptions,
    calculateRecurringSpend,
    calculateTotalSpend,
    checkDuplicate,
} from "@/lib/subscription-utils";
import { checkBudgetAlerts } from "@/lib/budget-utils";
import { apiPost } from "@/lib/api";

import { analyticsApi, AnalyticsSummary } from "@/lib/api/analytics";
import type {
    AppClientProps,
    EmailAccount,
    Payment,
    PriceChange,
    ConsolidationSuggestion,
    Workspace,
    SubscriptionUpdates,
} from "./app-client.types";

import { UserSettingsProvider } from "@/components/providers/user-settings-provider";

const AnalyticsPage = dynamic(() => import("@/components/pages/analytics"), {
    loading: () => (
        <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
        </div>
    ),
});

const OnboardingTourEnhanced = dynamic(
    () => import("@/components/onboarding-tour-enhanced").then((mod) => mod.OnboardingTourEnhanced),
    { ssr: false }
);

export function AppClient({
    initialSubscriptions,
    initialEmailAccounts,
    initialPayments = [],
    initialPriceChanges = [],
    initialConsolidationSuggestions = [],
    initialAnalyticsSummary = null,
    dataLoadWarnings: _dataLoadWarnings,
    isDemo: _isDemo,
}: AppClientProps) {
    return (
        <UserSettingsProvider>
            <UndoProvider>
                <AppContent
                    initialSubscriptions={initialSubscriptions}
                    initialEmailAccounts={initialEmailAccounts}
                    initialPayments={initialPayments}
                    initialPriceChanges={initialPriceChanges}
                    initialConsolidationSuggestions={initialConsolidationSuggestions}
                    initialAnalyticsSummary={initialAnalyticsSummary}
                />
            </UndoProvider>
        </UserSettingsProvider>
    );
}

import { useUserSettings } from "@/components/providers/user-settings-provider";

function AppContent({
    initialSubscriptions,
    initialEmailAccounts,
    initialPayments = [],
    initialPriceChanges = [],
    initialConsolidationSuggestions = [],
    initialAnalyticsSummary = null,
}: {
    initialSubscriptions: DBSubscription[];
    initialEmailAccounts: EmailAccount[];
    initialPayments?: Payment[];
    initialPriceChanges?: PriceChange[];
    initialConsolidationSuggestions?: ConsolidationSuggestion[];
    initialAnalyticsSummary?: AnalyticsSummary | null;
}) {
    // User Settings
    const { settings, updateSettings: updateUserSettings } = useUserSettings();
    const currency = settings.currency;

    // Analytics state — seeded from the server; no post-mount fetch for first paint
    const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | undefined>(
        initialAnalyticsSummary ?? undefined,
    );

    // App state
    const [payments, setPayments] = useState(initialPayments);
    const [mode, setMode] = useState<
        "welcome" | "individual" | "enterprise" | "enterprise-setup"
    >("welcome");
    const [accountType, setAccountType] = useState<
        "individual" | "team" | "enterprise"
    >("individual");
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [activeView, setActiveView] = useState("dashboard");
    const [currentPlan, setCurrentPlan] = useState("free");
    const [darkMode, setDarkMode] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [budgetLimit, setBudgetLimit] = useState(500);
    const [showInsightsPage, setShowInsightsPage] = useState(false);
    const [showAddSubscription, setShowAddSubscription] = useState(false);
    const [showUpgradePlan, setShowUpgradePlan] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showManageSubscription, setShowManageSubscription] = useState(false);
    const [showInsights, setShowInsights] = useState(false);
    const [showEditSubscription, setShowEditSubscription] = useState(false);
    const [showDeletedPanel, setShowDeletedPanel] = useState(false);
    const [isLoadingSubscriptions, setIsLoadingSubscriptions] = useState(true);
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
    const [ratesStale, setRatesStale] = useState(false);
    const [isOffline, setIsOffline] = useState(false);

    // Data state
    const [priceChanges, setPriceChanges] = useState(initialPriceChanges);
    const [consolidationSuggestions, setConsolidationSuggestions] = useState(
        initialConsolidationSuggestions
    );

    // Custom hooks
    const auth = useAuth();
    const { toasts, showToast, removeToast } = useToast();
    const { confirmDialog, showDialog, hideDialog } = useConfirmationDialog();
    const { shouldShowTour, completeTour, skipTour, resetTour } = useOnboardingTourEnhanced();
    const {
        addDeletedSubscription,
        restoreSubscription,
        deletedSubscriptions,
        clearDeletedSubscriptions,
    } = useUndoContext();

    const {
        subscriptions,
        loading,
        bulkActionLoading,
        selectedSubscriptions,
        selectedSubscription,
        canUndo,
        canRedo,
        setSelectedSubscription,
        setBulkActionLoading,
        setSelectedSubscriptions,
        updateSubscriptions,
        addToHistory,
        undo,
        redo,
        handleAddSubscription,
        handleDeleteSubscription: handleDeleteSubscriptionHook,
        handleEditSubscription,
        handleCancelSubscription,
        handlePauseSubscription,
        handleResumeSubscription,
        handleToggleSubscriptionSelect,
    } = useSubscriptions({
        initialSubscriptions,
        maxSubscriptions:
            currentPlan === "free" ? 5 : currentPlan === "pro" ? 20 : 100,
        emailAccounts: initialEmailAccounts,
        onToast: showToast,
        onUpgradePlan: () => setShowUpgradePlan(true),
        onShowDialog: showDialog,
        onDeleteWithUndo: addDeletedSubscription,
    });

    const handleRestoreSubscription = useCallback(async (id: number) => {
        const restored = restoreSubscription(id);
        if (restored) {
            try {
                await createSubscription({
                    name: restored.name,
                    category: restored.category,
                    price: restored.price,
                    icon: restored.icon || "🔗",
                    renews_in: restored.renews_in || 30,
                    status: restored.status,
                    color: restored.color || "#000000",
                    renewal_url: restored.renewal_url || null,
                    tags: restored.tags || [],
                    date_added: restored.date_added,
                    email_account_id: restored.email_account_id,
                    last_used_at: restored.last_used_at,
                    has_api_key: restored.has_api_key,
                    is_trial: restored.is_trial,
                    trial_ends_at: restored.trial_ends_at,
                    price_after_trial: restored.price_after_trial,
                    source: restored.source || "manual",
                    manually_edited: restored.manually_edited,
                    edited_fields: restored.edited_fields || [],
                    pricing_type: restored.pricing_type || "fixed",
                    billing_cycle: restored.billing_cycle || "monthly",
                });
                const updatedSubs = [...(Array.isArray(subscriptions) ? subscriptions : []), { ...restored, id: Date.now() }];
                updateSubscriptions(updatedSubs);
                showToast({
                    title: "Restored",
                    description: `${restored.name} has been restored`,
                    variant: "success",
                });
            } catch (error) {
                showToast({
                    title: "Error",
                    description: "Failed to restore subscription",
                    variant: "error",
                });
            }
        }
    }, [restoreSubscription, subscriptions, updateSubscriptions, showToast]);

    const {
        emailAccounts,
        integrations,
        handleAddEmailAccount,
        handleRemoveEmailAccount,
        handleSetPrimaryEmail,
        handleRescanEmail,
        handleToggleIntegration,
    } = useEmailAccounts({
        initialAccounts: initialEmailAccounts,
        subscriptions: Array.isArray(subscriptions) ? subscriptions : [],
        updateSubscriptions: (subs: any[]) => updateSubscriptions(subs as any),
        addToHistory: (subs: any[]) => addToHistory(subs as any),
        onToast: showToast,
    });

    // Calculations
    const subscriptionsArray = Array.isArray(subscriptions) ? subscriptions : [];
    const recurringSpend = calculateRecurringSpend(subscriptionsArray);
    const totalSpend = calculateTotalSpend(subscriptionsArray);
    const renewalReminders = checkRenewalReminders(subscriptionsArray);
    const budgetAlert = checkBudgetAlerts(totalSpend, budgetLimit, currency);

    const { notifications, unreadNotifications, handleMarkNotificationRead } =
        useNotifications({
            subscriptions: subscriptionsArray,
            priceChanges,
            renewalReminders,
            consolidationSuggestions,
            budgetAlert,
        });

    const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions: subscriptionsArray,
        updateSubscriptions: (subs: any[]) => updateSubscriptions(subs as any),
        addToHistory: (subs: any[]) => addToHistory(subs as any),
        onCancelSubscription: handleCancelSubscription,
        onShowDialog: (dialog: any) => dialog ? showDialog(dialog) : hideDialog(),
        onToast: showToast,
        onShowInsightsPage: () => setShowInsightsPage(true),
    });

    const {
        handleBulkDelete,
        handleBulkExport,
        handleBulkCancel,
        handleBulkPause,
    } = useBulkActions({
        subscriptions: subscriptionsArray,
        selectedSubscriptions,
        updateSubscriptions: (subs: any[]) => updateSubscriptions(subs as any),
        addToHistory: (subs: any[]) => addToHistory(subs as any),
        setSelectedSubscriptions,
        setBulkActionLoading,
        onToast: showToast,
        onShowDialog: showDialog,
    });

    // Derived data
    const duplicates = detectDuplicates(subscriptionsArray);
    const unusedSubscriptions = detectUnusedSubscriptions(subscriptionsArray);
    const trialSubscriptions = getTrialSubscriptions(subscriptionsArray);
    const cancelledSubscriptions = getCancelledSubscriptions(subscriptionsArray);
    const pausedSubscriptions = getPausedSubscriptions(subscriptionsArray);
    const maxSubscriptions =
        currentPlan === "free" ? 5 : currentPlan === "pro" ? 20 : 100;

    // Effects
    useEffect(() => {
        async function fetchRates() {
            try {
                const response = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/exchange-rates?base=${currency}`,
                    { credentials: 'include' }
                );
                if (response.ok) {
                    const json = await response.json();
                    if (json.success) {
                        setExchangeRates(json.data.rates);
                        setRatesStale(json.data.stale);
                    }
                }
            } catch {
                // Rates fetch failed — dashboard will show native currencies without conversion
            }
        }
        fetchRates();
    }, [currency]);

    // Analytics summary is computed server-side and passed in as
    // initialAnalyticsSummary, so no client fetch happens on first paint.
    // The analytics state is refreshed only when subscriptions change after
    // mount (add/edit/delete), keeping the dashboard in sync without a
    // post-mount fetch on page load.
    const isFirstRender = useRef(true);
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        async function fetchAnalytics() {
            try {
                const summary = await analyticsApi.getSummary();
                setAnalyticsSummary(summary);
            } catch (error) {
                console.error("Failed to fetch analytics summary:", error);
            }
        }
        fetchAnalytics();
    }, [subscriptions]);

    useEffect(() => {
        setIsLoadingSubscriptions(false);
    }, []);

    useEffect(() => {
        function handleOnline() {
            setIsOffline(false);
            showToast({
                title: "Back online",
                description: "Your connection has been restored",
                variant: "success",
            });
        }

        function handleOffline() {
            setIsOffline(true);
            showToast({
                title: "You're offline",
                description: "Some features may not work until you reconnect",
                variant: "error",
            });
        }

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        setIsOffline(!isOnline());

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, [showToast]);

    // Handlers
    const handleLogin = async (email: string, password: string) => {
        await auth.handleLogin(email, password, () => {
            setMode("individual");
            setAccountType("individual");
            showToast({
                title: "Welcome back!",
                description: "You've been signed in successfully.",
                variant: "success",
            });
        });
    };

    const handleSignup = () => {
        auth.handleSignup();
    };

    const handleModeSelect = (selectedMode: "individual" | "enterprise") => {
        if (selectedMode === "individual") {
            setMode("individual");
            setAccountType("individual");
        } else {
            setMode("enterprise-setup");
            setAccountType("enterprise");
        }
    };

    const handleEnterpriseSetupComplete = (workspaceData: Workspace) => {
        setWorkspace(workspaceData);
        setMode("enterprise");
        setCurrentPlan("enterprise");
        setAccountType("enterprise");
    };

    const handleBackToWelcome = () => {
        setMode("welcome");
    };

    const handleUpgradeToTeam = (workspaceData: Workspace) => {
        setWorkspace(workspaceData);
        setAccountType("team");
        setCurrentPlan("team");
        showToast({
            title: "Team account created!",
            description: `Welcome to ${workspaceData.name}. Invitations have been sent to your team members.`,
            variant: "success",
        });
    };

    const handleUpgradePlan = (newPlan: string) => {
        setCurrentPlan(newPlan);
        setShowUpgradePlan(false);
        showToast({
            title: "Plan upgraded",
            description: `Your plan has been upgraded to ${newPlan}`,
            variant: "success",
        });
    };

    const handleBudgetChange = async (limit: number) => {
        setBudgetLimit(limit);
        try {
            await analyticsApi.upsertBudget({ overall_limit: limit });
            // Refresh analytics summary to reflect the new budget
            const summary = await analyticsApi.getSummary();
            setAnalyticsSummary(summary);
            showToast({
                title: "Budget updated",
                description: `Your monthly budget has been set to ${limit}`,
                variant: "success",
            });
        } catch (error) {
            console.error("Failed to update budget:", error);
            showToast({
                title: "Error",
                description: "Failed to update budget on server",
                variant: "error",
            });
        }
    };

    const handleManageSubscription = (subscription: DBSubscription) => {
        setSelectedSubscription(subscription as any);
        setShowManageSubscription(true);
    };

    const handleRenewSubscription = (subscription: DBSubscription) => {
        if (subscription.renewal_url) {
            window.open(subscription.renewal_url, "_blank");
            apiPost(`/api/subscriptions/${subscription.id}/track-interaction`).catch(() => {});
        }
    };

    const handleViewInsights = () => {
        setShowInsightsPage(true);
    };

    const handleDeleteSubscription = (id: number) => {
        const sub = subscriptionsArray.find((s) => s.id === id);
        if (!sub) return;

        showDialog({
            title: "Delete subscription?",
            description: `Are you sure you want to delete ${sub.name}? This action cannot be undone.`,
            variant: "danger",
            confirmLabel: "Delete",
            onConfirm: async () => {
                await handleDeleteSubscriptionHook(id);
                hideDialog();
            },
            onCancel: () => hideDialog(),
        });
    };

    const handleAddFromNotification = (subscription: DetectedSubscription) => {
        if (checkDuplicate(subscriptionsArray, subscription.name)) {
            alert(`${subscription.name} already exists in your subscriptions!`);
            return;
        }

        if (subscriptionsArray.length >= maxSubscriptions) {
            setShowUpgradePlan(true);
            return;
        }

        const updatedSubs = [
            ...subscriptionsArray,
            {
                ...subscription,
                id: Math.max(...subscriptionsArray.map((s) => s.id), 0) + 1,
                dateAdded: new Date().toISOString(),
                emailAccountId:
                    subscription.emailAccountId ||
                    emailAccounts.find((acc) => acc.isPrimary)?.id ||
                    1,
                source: "manual",
                manuallyEdited: false,
                editedFields: [],
                pricingType: "fixed",
                billingCycle: "monthly",
            },
        ];
        updateSubscriptions(updatedSubs as any);
        addToHistory(updatedSubs as any);
    };

    // Early returns for auth/onboarding
    if (auth.showLandingAuth) {
        return (
            <LandingAuth
                onLogin={handleLogin}
                onSignup={handleSignup}
                darkMode={darkMode}
                isLoading={auth.authLoading}
                error={auth.authError}
            />
        );
    }

    if (auth.showOnboarding) {
        return (
            <OnboardingModal
                onClose={() => {
                    auth.setShowOnboarding(false);
                    localStorage.setItem("onboarding_completed", "true");
                }}
                onModeSelect={handleModeSelect}
                darkMode={darkMode}
            />
        );
    }

    if (mode === "welcome") {
        return (
            <WelcomePage onSelectMode={handleModeSelect} darkMode={darkMode} />
        );
    }

    if (mode === "enterprise-setup") {
        return (
            <EnterpriseSetup
                onComplete={handleEnterpriseSetupComplete}
                onBack={handleBackToWelcome}
                darkMode={darkMode}
            />
        );
    }

    if (isLoadingSubscriptions) {
        return (
            <div
                className={`min-h-screen ${
                    darkMode
                        ? "bg-[#1E2A35] text-[#F9F6F2]"
                        : "bg-[#F9F6F2] text-[#1E2A35]"
                } flex items-center justify-center`}
            >
                <LoadingSpinner size="lg" darkMode={darkMode} />
            </div>
        );
    }

    return (
        <UndoProvider>
            <ErrorBoundary>
                <AppLayout
                activeView={activeView}
                onViewChange={setActiveView}
                mode={mode}
                darkMode={darkMode}
                onDarkModeToggle={() => setDarkMode(!darkMode)}
                currentPlan={currentPlan}
                onUpgradePlan={() => setShowUpgradePlan(true)}
                mobileMenuOpen={mobileMenuOpen}
                onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
                unreadNotifications={unreadNotifications}
                onNotificationsToggle={() =>
                    setShowNotifications(!showNotifications)
                }
                deletedCount={deletedSubscriptions.length}
                onDeletedToggle={() =>
                    setShowDeletedPanel(!showDeletedPanel)
                }
                onAddSubscription={() => setShowAddSubscription(true)}
                budgetAlert={budgetAlert}
                selectedSubscriptionsCount={selectedSubscriptions.size}
                canUndo={canUndo}
                canRedo={canRedo}
                bulkActionLoading={bulkActionLoading}
                onUndo={undo}
                onRedo={redo}
                onBulkExport={handleBulkExport}
                onBulkPause={handleBulkPause}
                onBulkCancel={handleBulkCancel}
                onBulkDelete={handleBulkDelete}
                isOffline={isOffline}
                onNavigate={(path) => setActiveView(path.replace('/', ''))}
                onCommandAction={(action) => {
                    if (action === "new-subscription") {
                        setShowAddSubscription(true);
                    } else if (action === "search") {
                        // Focus search input
                        const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
                        searchInput?.focus();
                    } else if (action === "toggle-theme") {
                        setDarkMode(!darkMode);
                    } else if (action === "sign-out") {
                        // Sign out logic
                        setMode("welcome");
                        auth.setIsAuthenticated(false);
                        auth.setShowLandingAuth(true);
                    }
                }}
            >
                {showInsightsPage ? (
                    <InsightsPage
                        insights={notifications}
                        totalSpend={totalSpend}
                        onClose={() => setShowInsightsPage(false)}
                        darkMode={darkMode}
                    />
                ) : (
                    <>
                        {activeView === "dashboard" && (
                            subscriptionsArray.length === 0 ? (
                                <EmptyState
                                    icon="📦"
                                    title="No subscriptions yet"
                                    description="Start tracking your subscriptions by connecting your email or adding them manually."
                                    action={{
                                        label: "Add your first subscription",
                                        onClick: () => setShowAddSubscription(true),
                                    }}
                                    darkMode={darkMode}
                                />
                            ) : (
                                <DashboardPage
                                    subscriptions={subscriptionsArray}
                                    totalSpend={totalSpend}
                                    summary={analyticsSummary}
                                    insights={notifications as any}
                                    onViewInsights={handleViewInsights}
                                    onRenew={handleRenewSubscription}
                                    onManage={handleManageSubscription}
                                    darkMode={darkMode}
                                    emailAccounts={emailAccounts}
                                    duplicates={duplicates}
                                    unusedSubscriptions={unusedSubscriptions as any}
                                    trialSubscriptions={trialSubscriptions}
                                    displayCurrency={currency}
                                    exchangeRates={exchangeRates}
                                    ratesStale={ratesStale}
                                    onRestartTour={resetTour}
                                />
                            )
                        )}
                        {activeView === "subscriptions" && (
                            subscriptionsArray.length === 0 ? (
                                <EmptyState
                                    icon="📦"
                                    title="No subscriptions yet"
                                    description="Start tracking your subscriptions by connecting your email or adding them manually."
                                    action={{
                                        label: "Add your first subscription",
                                        onClick: () => setShowAddSubscription(true),
                                    }}
                                    darkMode={darkMode}
                                />
                            ) : (
                                <SubscriptionsPage
                                    subscriptions={subscriptionsArray}
                                    onDelete={handleDeleteSubscription}
                                    maxSubscriptions={maxSubscriptions}
                                    currentPlan={currentPlan}
                                    onManage={handleManageSubscription as any}
                                    onRenew={handleRenewSubscription as any}
                                    selectedSubscriptions={selectedSubscriptions}
                                    onToggleSelect={handleToggleSubscriptionSelect}
                                    darkMode={darkMode}
                                    emailAccounts={emailAccounts}
                                    duplicates={duplicates}
                                    unusedSubscriptions={unusedSubscriptions as any}
                                    onPause={(sub) => handlePauseSubscription(sub.id)}
                                    onResume={(sub) => handleResumeSubscription(sub.id)}
                                />
                            )
                        )}
                        {activeView === "analytics" && (
                            analyticsSummary ? (
                                <AnalyticsPage
                                    summary={analyticsSummary}
                                    darkMode={darkMode}
                                />
                            ) : (
                                <div className="flex items-center justify-center py-20">
                                    <LoadingSpinner size="lg" darkMode={darkMode} />
                                </div>
                            )
                        )}
                        {activeView === "integrations" && (
                            <IntegrationsPage
                                integrations={integrations}
                                onToggle={handleToggleIntegration}
                                darkMode={darkMode}
                            />
                        )}
                        {activeView === "teams" && (
                            <TeamsPage
                                workspace={workspace!}
                                subscriptions={subscriptionsArray}
                                darkMode={darkMode}
                                emailAccounts={emailAccounts}
                            />
                        )}
                        {activeView === "settings" && (
                            <SettingsPage
                                currentPlan={currentPlan}
                                accountType={accountType}
                                onUpgradeToTeam={handleUpgradeToTeam}
                                onUpgrade={handleUpgradePlan}
                                budgetLimit={budgetLimit}
                                onBudgetChange={handleBudgetChange}
                                darkMode={darkMode}
                                currency={currency}
                                onCurrencyChange={(c: Currency) => updateUserSettings({ currency: c })}
                                timezone={settings.timezone}
                                onTimezoneChange={(tz: string) => updateUserSettings({ timezone: tz })}
                                payments={payments}
                                onRefund={async (transactionId: string) => {
                                    try {
                                        const response = await fetch("/api/payments/refund", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ transactionId }),
                                        });
                                        if (response.ok) {
                                            showToast({
                                                title: "Refund requested",
                                                description: "Your refund request has been submitted.",
                                                variant: "success",
                                            });
                                        } else {
                                            throw new Error("Refund failed");
                                        }
                                    } catch (error) {
                                        showToast({
                                            title: "Error",
                                            description: "Failed to request refund. Please contact support.",
                                            variant: "error",
                                        });
                                    }
                                }}
                                onRestartTour={resetTour}
                            />
                        )}
                    </>
                )}
            </AppLayout>
            </ErrorBoundary>

            {/* Onboarding Tour */}
            {shouldShowTour && mode === "individual" && (
                <OnboardingTourEnhanced
                    darkMode={darkMode}
                    onComplete={() => {
                        completeTour();
                        showToast({
                            title: "Welcome to SYNCRO!",
                            description: "You're all set up. Start adding your subscriptions to get the most out of the platform.",
                            variant: "success",
                        });
                    }}
                    onSkip={() => {
                        skipTour();
                        showToast({
                            title: "Tour skipped",
                            description: "You can restart the tour anytime from Settings.",
                            variant: "default",
                        });
                    }}
                />
            )}

            {/* Notifications Panel */}
            {showNotifications && (
                <NotificationsPanel
                    notifications={notifications}
                    onMarkRead={handleMarkNotificationRead}
                    onClose={() => setShowNotifications(false)}
                    onAddSubscription={handleAddFromNotification}
                    onResolveAction={handleResolveNotificationAction}
                    darkMode={darkMode}
                />
            )}

            {/* Modals */}
            {showAddSubscription && (
                <AddSubscriptionModal
                    onAdd={handleAddSubscription}
                    onClose={() => setShowAddSubscription(false)}
                    darkMode={darkMode}
                />
            )}
            {showUpgradePlan && (
                <UpgradePlanModal
                    currentPlan={currentPlan}
                    onUpgrade={handleUpgradePlan}
                    onClose={() => setShowUpgradePlan(false)}
                    darkMode={darkMode}
                />
            )}
            {showManageSubscription && selectedSubscription && (
                <ManageSubscriptionModal
                    subscription={selectedSubscription}
                    onClose={() => setShowManageSubscription(false)}
                    onDelete={() => {
                        handleDeleteSubscription(selectedSubscription.id);
                        setShowManageSubscription(false);
                    }}
                    onEdit={() => {
                        setShowManageSubscription(false);
                        setShowEditSubscription(true);
                    }}
                    onCancel={() => handleCancelSubscription(selectedSubscription.id)}
                    onPause={() => handlePauseSubscription(selectedSubscription.id)}
                    onResume={() => handleResumeSubscription(selectedSubscription.id)}
                    darkMode={darkMode}
                />
            )}
            {showEditSubscription && selectedSubscription && (
                <EditSubscriptionModal
                    subscription={selectedSubscription}
                    onSave={(updates: SubscriptionUpdates) =>
                        handleEditSubscription(selectedSubscription.id, updates)
                    }
                    onClose={() => setShowEditSubscription(false)}
                    darkMode={darkMode}
                />
            )}
            {showInsights && (
                <InsightsModal
                    insights={notifications}
                    totalSpend={totalSpend}
                    onClose={() => setShowInsights(false)}
                />
            )}

            <ToastContainer>
                {toasts.map((toast) => (
                    <Toast
                        key={toast.id}
                        title={toast.title}
                        description={toast.description}
                        variant={toast.variant}
                        action={toast.action}
                        onClose={() => removeToast(toast.id)}
                    />
                ))}
            </ToastContainer>

            {confirmDialog && (
                <ConfirmationDialog
                    title={confirmDialog.title}
                    description={confirmDialog.description}
                    variant={confirmDialog.variant}
                    confirmLabel={confirmDialog.confirmLabel}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                    darkMode={darkMode}
                />
            )}

            {/* Deleted Items Panel */}
            {showDeletedPanel && (
                <UndoPanel
                    deletedSubscriptions={deletedSubscriptions}
                    onRestore={handleRestoreSubscription}
                    onClose={() => setShowDeletedPanel(false)}
                    onClear={clearDeletedSubscriptions}
                    darkMode={darkMode}
                />
            )}
        </UndoProvider>
    );
}
