"use client";

import React from "react";

import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { MobileMenuButton } from "./mobile-menu-button";
import { BudgetAlert } from "./budget-alert";
import { BulkActionsBar } from "./bulk-actions-bar";
import { CommandPalette } from "@/components/command-palette";

interface AppLayoutProps {
    children: React.ReactNode;
    activeView: string;
    onViewChange: (view: string) => void;
    mode: "welcome" | "individual" | "enterprise" | "enterprise-setup";
    darkMode: boolean;
    onDarkModeToggle: () => void;
    currentPlan: string;
    onUpgradePlan: () => void;
    mobileMenuOpen: boolean;
    onMobileMenuToggle: () => void;
    unreadNotifications: number;
    onNotificationsToggle: () => void;
    deletedCount?: number;
    onDeletedToggle?: () => void;
    onAddSubscription?: () => void;
    budgetAlert?: {
        level: "critical" | "warning";
        message: string;
        percentage: string;
    } | null;
    selectedSubscriptionsCount: number;
    canUndo: boolean;
    canRedo: boolean;
    bulkActionLoading: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onBulkExport: () => void;
    onBulkPause: () => void;
    onBulkCancel: () => void;
    onBulkDelete: () => void;
    isOffline: boolean;
    onNavigate?: (path: string) => void;
    onCommandAction?: (action: string) => void;
}

export function AppLayout({
    children,
    activeView,
    onViewChange,
    mode,
    darkMode,
    onDarkModeToggle,
    currentPlan,
    onUpgradePlan,
    mobileMenuOpen,
    onMobileMenuToggle,
    unreadNotifications,
    onNotificationsToggle,
    deletedCount = 0,
    onDeletedToggle,
    onAddSubscription,
    budgetAlert,
    selectedSubscriptionsCount,
    canUndo,
    canRedo,
    bulkActionLoading,
    onUndo,
    onRedo,
    onBulkExport,
    onBulkPause,
    onBulkCancel,
    onBulkDelete,
    isOffline,
    onNavigate,
    onCommandAction,
}: AppLayoutProps) {
    return (
        <div
            className={`min-h-screen ${
                darkMode ? "bg-[#1E2A35] text-[#F9F6F2]" : "bg-[#F9F6F2] text-[#1E2A35]"
            } flex transition-colors duration-300`}
            role="main"
            aria-label="Subscription dashboard"
        >
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg"
            >
                Skip to main content
            </a>

            {isOffline && (
                <div className="fixed top-0 left-0 right-0 bg-destructive text-destructive-foreground px-4 py-2 text-center text-sm font-medium z-50">
                    You're currently offline. Some features may not work.
                </div>
            )}

            <MobileMenuButton mobileMenuOpen={mobileMenuOpen} onToggle={onMobileMenuToggle} darkMode={darkMode} />

            <Sidebar
                activeView={activeView}
                onViewChange={onViewChange}
                mode={mode}
                darkMode={darkMode}
                currentPlan={currentPlan}
                onUpgradePlan={onUpgradePlan}
                mobileMenuOpen={mobileMenuOpen}
                onMobileMenuToggle={onMobileMenuToggle}
            />

            <main className="flex-1 overflow-y-auto" id="main-content">
                <div className="p-4 md:p-8">
                    <Header
                        activeView={activeView}
                        darkMode={darkMode}
                        onDarkModeToggle={onDarkModeToggle}
                        unreadNotifications={unreadNotifications}
                        onNotificationsToggle={onNotificationsToggle}
                        deletedCount={deletedCount}
                        onDeletedToggle={onDeletedToggle}
                        onAddSubscription={onAddSubscription}
                    />

                    {budgetAlert && <BudgetAlert alert={budgetAlert} darkMode={darkMode} />}

                    {activeView === "subscriptions" && (
                        <BulkActionsBar
                            selectedCount={selectedSubscriptionsCount}
                            darkMode={darkMode}
                            canUndo={canUndo}
                            canRedo={canRedo}
                            bulkActionLoading={bulkActionLoading}
                            onUndo={onUndo}
                            onRedo={onRedo}
                            onExport={onBulkExport}
                            onPause={onBulkPause}
                            onCancel={onBulkCancel}
                            onDelete={onBulkDelete}
                        />
                    )}

                    {children}
                </div>
            </main>
            
            <CommandPalette onNavigate={onNavigate} onAction={onCommandAction} />
        </div>
    );
}
