"use client";

import {
    Home,
    CreditCard,
    BarChart3,
    Plug,
    Settings,
    Users,
} from "lucide-react";

interface SidebarProps {
    activeView: string;
    onViewChange: (view: string) => void;
    mode: "welcome" | "individual" | "enterprise" | "enterprise-setup";
    darkMode: boolean;
    currentPlan: string;
    onUpgradePlan: () => void;
    mobileMenuOpen: boolean;
    onMobileMenuToggle: () => void;
}

export function Sidebar({
    activeView,
    onViewChange,
    mode,
    darkMode,
    currentPlan,
    onUpgradePlan,
    mobileMenuOpen,
    onMobileMenuToggle,
}: SidebarProps) {
    const navItems = [
        { id: "dashboard", label: "Dashboard", icon: Home },
        { id: "subscriptions", label: "Subscriptions", icon: CreditCard },
        { id: "analytics", label: "Analytics", icon: BarChart3 },
        { id: "integrations", label: "Integrations", icon: Plug },
        ...(mode === "enterprise"
            ? [{ id: "teams", label: "Teams", icon: Users }]
            : []),
        { id: "settings", label: "Settings", icon: Settings },
    ];

    return (
        <>
            <aside
                className={`${
                    mobileMenuOpen
                        ? "translate-x-0"
                        : "-translate-x-full md:translate-x-0"
                } fixed md:relative w-56 border-r ${
                    darkMode
                        ? "border-[#374151] bg-[#2D3748]"
                        : "border-gray-200 bg-white"
                } p-6 flex flex-col transition-transform duration-300 z-40 h-screen`}
                role="navigation"
                aria-label="Main navigation"
            >
                <div className="mb-12">
                    <h1
                        className={`text-xl font-bold ${
                            darkMode ? "text-white" : "text-[#1E2A35]"
                        }`}
                    >
                        Subsync.AI
                    </h1>
                </div>

                <nav className="flex-1 space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeView === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => {
                                    onViewChange(item.id);
                                    onMobileMenuToggle();
                                }}
                                data-tour={item.id === "integrations" ? "connect-email" : item.id === "settings" ? "wallet-settings" : undefined}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 ${
                                    isActive
                                        ? darkMode
                                            ? "bg-[#FFD166] text-[#1E2A35]"
                                            : "bg-[#1E2A35] text-white"
                                        : darkMode
                                        ? "text-[#F9F6F2] hover:bg-[#374151]"
                                        : "text-[#1E2A35] hover:bg-[#F9F6F2]"
                                }`}
                                aria-label={`Navigate to ${item.label}`}
                                aria-current={isActive ? "page" : undefined}
                            >
                                <Icon
                                    className="w-5 h-5"
                                    strokeWidth={1.5}
                                    aria-hidden="true"
                                />
                                <span className="text-sm">{item.label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div
                    className={`mt-auto pt-6 border-t ${
                        darkMode ? "border-gray-700" : "border-gray-200"
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-10 h-10 ${
                                darkMode ? "bg-[#FFD166]" : "bg-[#FFD166]"
                            } rounded-full flex items-center justify-center text-lg text-[#1E2A35]`}
                        >
                            👤
                        </div>
                        <div className="flex-1">
                            <div
                                className={`text-sm font-semibold ${
                                    darkMode ? "text-white" : "text-[#1E2A35]"
                                }`}
                            >
                                Caleb Alexhone
                            </div>
                            <button
                                onClick={onUpgradePlan}
                                className={`text-xs ${
                                    darkMode
                                        ? "text-gray-400 hover:text-gray-300"
                                        : "text-gray-500 hover:text-gray-700"
                                }`}
                            >
                                {currentPlan === "free"
                                    ? "Upgrade plan"
                                    : `${currentPlan} plan`}
                            </button>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
}
