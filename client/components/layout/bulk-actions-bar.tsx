"use client";

import { Download } from "lucide-react";
import { LoadingSpinner } from "@syncro/ui";

interface BulkActionsBarProps {
    selectedCount: number;
    darkMode: boolean;
    canUndo: boolean;
    canRedo: boolean;
    bulkActionLoading: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onExport: () => void;
    onPause: () => void;
    onCancel: () => void;
    onDelete: () => void;
}

export function BulkActionsBar({
    selectedCount,
    darkMode,
    canUndo,
    canRedo,
    bulkActionLoading,
    onUndo,
    onRedo,
    onExport,
    onPause,
    onCancel,
    onDelete,
}: BulkActionsBarProps) {
    if (selectedCount === 0) return null;

    return (
        <div
            className={`mb-6 p-4 ${
                darkMode ? "bg-[#007A5C]/20 border-[#007A5C]" : "bg-blue-50 border-blue-200"
            } border rounded-lg flex items-center justify-between`}
        >
            <p className={`text-sm font-medium ${darkMode ? "text-[#007A5C]" : "text-blue-800"}`}>
                {selectedCount} subscription(s) selected
            </p>
            <div className="flex gap-2">
                <button
                    onClick={onUndo}
                    disabled={!canUndo || bulkActionLoading}
                    className={`px-3 py-1.5 text-sm ${
                        darkMode ? "bg-[#2D3748] hover:bg-[#374151]" : "bg-gray-200 hover:bg-gray-300"
                    } rounded disabled:opacity-50 flex items-center gap-2`}
                >
                    {bulkActionLoading ? <LoadingSpinner size="sm" darkMode={darkMode} /> : "Undo"}
                </button>
                <button
                    onClick={onRedo}
                    disabled={!canRedo || bulkActionLoading}
                    className={`px-3 py-1.5 text-sm ${
                        darkMode ? "bg-[#2D3748] hover:bg-[#374151]" : "bg-gray-200 hover:bg-gray-300"
                    } rounded disabled:opacity-50`}
                >
                    Redo
                </button>
                <button
                    onClick={onExport}
                    disabled={bulkActionLoading}
                    className="px-3 py-1.5 text-sm bg-[#007A5C] text-white rounded hover:bg-[#007A5C]/90 disabled:opacity-50 flex items-center gap-2"
                >
                    <Download className="w-4 h-4" />
                    Export CSV
                </button>
                <button
                    onClick={onPause}
                    disabled={bulkActionLoading}
                    className="px-3 py-1.5 text-sm bg-[#FFD166] text-[#1E2A35] rounded hover:bg-[#FFD166]/90 disabled:opacity-50 flex items-center gap-2"
                >
                    {bulkActionLoading && <LoadingSpinner size="sm" />}
                    Pause Selected
                </button>
                <button
                    onClick={onCancel}
                    disabled={bulkActionLoading}
                    className="px-3 py-1.5 text-sm bg-[#FFD166] text-[#1E2A35] rounded hover:bg-[#FFD166]/90 disabled:opacity-50 flex items-center gap-2"
                >
                    {bulkActionLoading && <LoadingSpinner size="sm" />}
                    Cancel Selected
                </button>
                <button
                    onClick={onDelete}
                    disabled={bulkActionLoading}
                    className="px-3 py-1.5 text-sm bg-[#E86A33] text-white rounded hover:bg-[#E86A33]/90 disabled:opacity-50 flex items-center gap-2"
                >
                    {bulkActionLoading && <LoadingSpinner size="sm" darkMode />}
                    Delete Selected
                </button>
            </div>
        </div>
    );
}

