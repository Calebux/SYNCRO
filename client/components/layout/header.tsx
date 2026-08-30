"use client";

import { Bell, Moon, Sun, Plus, Trash2 } from "lucide-react";

interface HeaderProps {
    activeView: string;
    darkMode: boolean;
    onDarkModeToggle: () => void;
    unreadNotifications: number;
    onNotificationsToggle: () => void;
    deletedCount?: number;
    onDeletedToggle?: () => void;
    onAddSubscription?: () => void;
}

const viewTitles: Record<string, { title: string; description: string }> = {
    dashboard: {
        title: "Dashboard",
        description: "Welcome back! Here is your AI subscription overview.",
    },
    subscriptions: {
        title: "Subscriptions",
        description: "Manage and track all your AI tool subscriptions",
    },
    analytics: {
        title: "Analytics",
        description: "View detailed analytics and spending insights",
    },
    integrations: {
        title: "Integrations",
        description: "Central control for all your data connections",
    },
    teams: {
        title: "Teams",
        description: "Manage your team members and their subscriptions",
    },
    settings: {
        title: "Settings",
        description: "Account management and preferences",
    },
};

export function Header({
    activeView,
    darkMode,
    onDarkModeToggle,
    unreadNotifications,
    onNotificationsToggle,
    deletedCount = 0,
    onDeletedToggle,
    onAddSubscription,
}: HeaderProps) {
    const viewInfo = viewTitles[activeView] || { title: "", description: "" };

    return (
        <div className="flex items-center justify-between mb-8">
            <div>
                <h2
                    className={`text-2xl font-bold ${
                        darkMode ? "text-white" : "text-[#1E2A35]"
                    }`}
                >
                    {viewInfo.title}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                    <p
                        className={`text-sm ${
                            darkMode ? "text-gray-400" : "text-gray-500"
                        }`}
                    >
                        {viewInfo.description}
                    </p>
                    <span
                        className={`text-xs px-2 py-1 rounded-md border ${
                            darkMode
                                ? "bg-[#2D3748] border-[#4A5568] text-gray-300"
                                : "bg-gray-100 border-gray-300 text-gray-600"
                        } opacity-70 hover:opacity-100 transition-opacity`}
                    >
                        Press <kbd className={`px-1 py-0.5 rounded text-xs font-mono border ${darkMode ? "bg-[#1E2A35] border-[#4A5568]" : "bg-white border-gray-400"}`}>Ctrl+K</kbd> to open command palette
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={onDarkModeToggle}
                    className={`p-2 ${
                        darkMode ? "hover:bg-[#2D3748]" : "hover:bg-gray-100"
                    } rounded-lg transition-colors`}
                    aria-label={
                        darkMode
                            ? "Switch to light mode"
                            : "Switch to dark mode"
                    }
                >
                    {darkMode ? (
                        <Sun className="w-5 h-5" />
                    ) : (
                        <Moon className="w-5 h-5" />
                    )}
                </button>
                <button
                    onClick={onNotificationsToggle}
                    className={`p-2 ${
                        darkMode ? "hover:bg-[#2D3748]" : "hover:bg-gray-100"
                    } rounded-lg relative transition-colors`}
                    aria-label={`Notifications (${unreadNotifications} unread)`}
                >
                    <Bell className="w-5 h-5" />
                    {unreadNotifications > 0 && (
                        <span className="absolute top-1 right-1 bg-[#E86A33] text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            {unreadNotifications}
                        </span>
                    )}
                </button>
                {onDeletedToggle && (
                    <button
                        onClick={onDeletedToggle}
                        className={`p-2 ${
                            darkMode ? "hover:bg-[#2D3748]" : "hover:bg-gray-100"
                        } rounded-lg relative transition-colors`}
                        aria-label={`Recently deleted (${deletedCount})`}
                    >
                        <Trash2 className="w-5 h-5" />
                        {deletedCount > 0 && (
                            <span className="absolute top-1 right-1 bg-[#E86A33] text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                {deletedCount}
                            </span>
                        )}
                    </button>
                )}
                {onAddSubscription && (
                    <button
                        onClick={onAddSubscription}
                        data-tour="add-subscription"
                        className={`flex items-center gap-2 ${
                            darkMode
                                ? "bg-[#FFD166] text-[#1E2A35] hover:bg-[#FFD166]/90"
                                : "bg-[#1E2A35] text-white hover:bg-[#2D3748]"
                        } px-4 py-2 rounded-lg text-sm font-medium transition-colors`}
                    >
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">
                            Add subscription
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
}
