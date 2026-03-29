"use client";

import { useState, useEffect, Suspense } from "react";
import WelcomePage from "@/components/pages/welcome";
import EnterpriseSetup from "@/components/pages/enterprise-setup";
import DashboardPage from "@/components/pages/dashboard";
import LandingAuth from "@/components/pages/landing-auth";
import SubscriptionsPage from "@/components/pages/subscriptions";
import AnalyticsPage from "@/components/pages/analytics";
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
import { Toast, ToastContainer } from "@/components/ui/toast";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AppLayout } from "@/components/layout/app-layout";
import type { Subscription as DBSubscription } from "@/lib/supabase/subscriptions";
import { deleteSubscription } from "@/lib/supabase/subscriptions";
import { isOnline } from "@/lib/network-utils";
import type { Currency } from "@/lib/currency-utils";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useConfirmationDialog } from "@/hooks/use-confirmation-dialog";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { useBulkActions } from "@/hooks/use-bulk-actions";
import { useEmailAccounts } from "@/hooks/use-email-accounts";
import { useNotifications } from "@/hooks/use-notifications";
import { useNotificationActions } from "@/hooks/use-notification-actions";
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

import { analyticsApi, AnalyticsSummary } from "@/lib/api/analytics";

interface AppClientProps {
    initialSubscriptions: DBSubscription[];
    initialEmailAccounts: any[];
    initialPriceChanges?: any[];
    initialConsolidationSuggestions?: any[];
}

export function AppClient({
    initialSubscriptions,
    initialEmailAccounts,
    initialPriceChanges = [],
    initialConsolidationSuggestions = [],
}: AppClientProps) {
    // Analytics state
    const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | undefined>(undefined);

    // App state
    const [mode, setMode] = useState<
        "welcome" | "individual" | "enterprise" | "enterprise-setup"
    >("welcome");
    const [accountType, setAccountType] = useState<
        "individual" | "team" | "enterprise"
    >("individual");
    const [workspace, setWorkspace] = useState<any>(null);
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
    const [isLoadingSubscriptions, setIsLoadingSubscriptions] = useState(true);
    const [currency, setCurrency] = useState<Currency>("USD");
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
    });

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
        subscriptions,
        updateSubscriptions,
        addToHistory,
        onToast: showToast,
    });

    // Calculations
    const recurringSpend = calculateRecurringSpend(subscriptions);
    const totalSpend = calculateTotalSpend(subscriptions);
    const renewalReminders = checkRenewalReminders(subscriptions);
    const budgetAlert = checkBudgetAlerts(totalSpend, budgetLimit);

    const { notifications, unreadNotifications, handleMarkNotificationRead } =
        useNotifications({
            subscriptions,
            priceChanges,
            renewalReminders,
            consolidationSuggestions,
            budgetAlert,
        });

    const { handleResolveNotificationAction } = useNotificationActions({
        subscriptions,
        updateSubscriptions,
        addToHistory,
        onCancelSubscription: handleCancelSubscription,
        onShowDialog: showDialog,
        onToast: showToast,
        onShowInsightsPage: () => setShowInsightsPage(true),
    });

    const {
        handleBulkDelete,
        handleBulkExport,
        handleBulkCancel,
        handleBulkPause,
    } = useBulkActions({
        subscriptions,
        selectedSubscriptions,
        updateSubscriptions,
        addToHistory,
        setSelectedSubscriptions,
        setBulkActionLoading,
        onToast: showToast,
        onShowDialog: showDialog,
    });

    // Derived data
    const duplicates = detectDuplicates(subscriptions);
    const unusedSubscriptions = detectUnusedSubscriptions(subscriptions);
    const trialSubscriptions = getTrialSubscriptions(subscriptions);
    const cancelledSubscriptions = getCancelledSubscriptions(subscriptions);
    const pausedSubscriptions = getPausedSubscriptions(subscriptions);
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

    useEffect(() => {
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

    const handleEnterpriseSetupComplete = (workspaceData: any) => {
        setWorkspace(workspaceData);
        setMode("enterprise");
        setCurrentPlan("enterprise");
        setAccountType("enterprise");
    };

    const handleBackToWelcome = () => {
        setMode("welcome");
    };

    const handleUpgradeToTeam = (workspaceData: any) => {
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

    const handleManageSubscription = (subscription: any) => {
        setSelectedSubscription(subscription);
        setShowManageSubscription(true);
    };

    const handleRenewSubscription = (subscription: any) => {
        if (subscription.renewalUrl) {
            window.open(subscription.renewalUrl, "_blank");
        }
    };

    const handleViewInsights = () => {
        setShowInsightsPage(true);
    };

    const handleDeleteSubscription = (id: number) => {
        const sub = subscriptions.find((s) => s.id === id);
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

    const handleAddFromNotification = (subscription: any) => {
        if (checkDuplicate(subscriptions, subscription.name)) {
            alert(`${subscription.name} already exists in your subscriptions!`);
            return;
        }

        if (subscriptions.length >= maxSubscriptions) {
            setShowUpgradePlan(true);
            return;
        }

        const updatedSubs = [
            ...subscriptions,
            {
                ...subscription,
                id: Math.max(...subscriptions.map((s) => s.id), 0) + 1,
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
        updateSubscriptions(updatedSubs);
        addToHistory(updatedSubs);
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

    if (subscriptions.length === 0) {
        return (
            <div
                className={`min-h-screen ${
                    darkMode
                        ? "bg-[#1E2A35] text-[#F9F6F2]"
                        : "bg-[#F9F6F2] text-[#1E2A35]"
                } `}
            >
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
            </div>
        );
    }

    return (
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
                            <DashboardPage
                                subscriptions={subscriptions}
                                totalSpend={totalSpend}
                                summary={analyticsSummary}
                                insights={notifications}
                                onViewInsights={handleViewInsights}
                                onRenew={handleRenewSubscription}
                                onManage={handleManageSubscription}
                                darkMode={darkMode}
                                emailAccounts={emailAccounts}
                                duplicates={duplicates}
                                unusedSubscriptions={unusedSubscriptions}
                                trialSubscriptions={trialSubscriptions}
                                displayCurrency={currency}
                                exchangeRates={exchangeRates}
                                ratesStale={ratesStale}
                            />
                        )}
                        {activeView === "subscriptions" && (
                            <SubscriptionsPage
                                subscriptions={subscriptions}
                                onDelete={handleDeleteSubscription}
                                maxSubscriptions={maxSubscriptions}
                                currentPlan={currentPlan}
                                onManage={handleManageSubscription}
                                onRenew={handleRenewSubscription}
                                selectedSubscriptions={selectedSubscriptions}
                                onToggleSelect={handleToggleSubscriptionSelect}
                                darkMode={darkMode}
                                emailAccounts={emailAccounts}
                                duplicates={duplicates}
                                unusedSubscriptions={unusedSubscriptions}
                            />
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
                                workspace={workspace}
                                subscriptions={subscriptions}
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
                                onCurrencyChange={(c: Currency) => setCurrency(c)}
                            />
                        )}
                    </>
                )}
            </AppLayout>

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
                    onSave={(updates: any) =>
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
        </ErrorBoundary>
    );
}

