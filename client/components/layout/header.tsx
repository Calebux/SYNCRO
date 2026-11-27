"use client";

import { Bell, Moon, Sun } from "lucide-react";

interface HeaderProps {
    activeView: string;
    darkMode: boolean;
    onDarkModeToggle: () => void;
    unreadNotifications: number;
    onNotificationsToggle: () => void;
}

const viewTitles: Record<string, { title: string; description: string }> = {
    dashboard: {
        title: "Dashboard",
        description: "Welcome back! Here is your overview.",
    },
    teams: {
        title: "Teams",
        description: "Manage your team members",
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
            </div>
        </div>
    );
}
