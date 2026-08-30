"use client";

import { useCallback } from "react";
import {
  bulkDeleteSubscriptions,
  updateSubscription,
} from "@/lib/supabase/subscriptions";
import { generateSafeCSV, downloadCSV } from "@/lib/csv-utils";
import type { Subscription } from "@/lib/supabase/subscriptions";

interface ClientSubscription {
  id: number;
  name: string;
  category: string;
  price: number;
  icon: string;
  renewsIn: number;
  status: string;
  color: string;
  renewalUrl: string | null;
  tags: string[];
  dateAdded: string;
  emailAccountId: number | null;
  lastUsedAt?: string;
  hasApiKey?: boolean;
  isTrial: boolean;
  trialEndsAt?: string;
  priceAfterTrial?: number;
  trialConvertsToPrice?: number;
  creditCardRequired?: boolean;
  source: string;
  manuallyEdited: boolean;
  editedFields: string[];
  pricingType: string;
  billingCycle: string;
  cancelledAt?: string;
  activeUntil?: string;
  pausedAt?: string;
  resumesAt?: string;
  priceRange?: { min: number; max: number };
  priceHistory?: Array<{ date: string; amount: number }>;
  expiredAt?: string;
  notes?: string;
  customTagIds?: string[];
}

interface ExportRow {
  name: string;
  category: string;
  price: number;
  billingCycle: string;
  status: string;
  renewalDate: string;
  email: string;
}

interface UseBulkActionsProps {
  subscriptions: ClientSubscription[];
  selectedSubscriptions: Set<number>;
  updateSubscriptions: (subs: ClientSubscription[]) => void;
  addToHistory: (subs: ClientSubscription[]) => void;
  setSelectedSubscriptions: (set: Set<number>) => void;
  setBulkActionLoading: (loading: boolean) => void;
  onToast: (toast: any) => void;
  onShowDialog: (dialog: any) => void;
}

export function useBulkActions({
  subscriptions,
  selectedSubscriptions,
  updateSubscriptions,
  addToHistory,
  setSelectedSubscriptions,
  setBulkActionLoading,
  onToast,
  onShowDialog,
}: UseBulkActionsProps) {
  const handleBulkDelete = useCallback(() => {
    if (selectedSubscriptions.size === 0) {
      onToast({
        title: "No subscriptions selected",
        description: "Please select at least one subscription to delete",
        variant: "error",
      });
      return;
    }

    onShowDialog({
      title: "Delete selected subscriptions?",
      description: `Are you sure you want to delete ${selectedSubscriptions.size} subscription(s)? This action cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete All",
      onConfirm: async () => {
        setBulkActionLoading(true);
        onShowDialog(null);

        try {
          const selectedIds = Array.from(selectedSubscriptions) as number[];
          await bulkDeleteSubscriptions(selectedIds);

          const updatedSubs = subscriptions.filter(
            (sub) => !selectedIds.includes(sub.id)
          );
          updateSubscriptions(updatedSubs);
          addToHistory(updatedSubs);

          setSelectedSubscriptions(new Set());

          onToast({
            title: "All subscriptions deleted",
            description: `Successfully deleted ${selectedIds.length} subscription(s)`,
            variant: "success",
          });
        } catch (error) {
          onToast({
            title: "Error",
            description: "Failed to delete subscriptions",
            variant: "error",
          });
        } finally {
          setBulkActionLoading(false);
        }
      },
      onCancel: () => onShowDialog(null),
    });
  }, [
    selectedSubscriptions,
    subscriptions,
    updateSubscriptions,
    addToHistory,
    setSelectedSubscriptions,
    setBulkActionLoading,
    onToast,
    onShowDialog,
  ]);

  const handleBulkExport = useCallback(() => {
    if (selectedSubscriptions.size === 0) {
      onToast({
        title: "No subscriptions selected",
        description: "Please select at least one subscription to export",
        variant: "error",
      });
      return;
    }

    const selectedSubs = subscriptions.filter((sub) =>
      selectedSubscriptions.has(sub.id)
    );

    const exportRows: ExportRow[] = selectedSubs.map((sub) => ({
      name: sub.name,
      category: sub.category,
      price: sub.price,
      billingCycle: sub.billingCycle || "monthly",
      status: sub.status,
      renewalDate: sub.renewsIn ? `${sub.renewsIn} days` : "N/A",
      email: "N/A",
    }));

    const headers = [
      "Name",
      "Category",
      "Price",
      "Billing Cycle",
      "Status",
      "Renewal Date",
      "Email",
    ];
    const rows = exportRows.map((row) => [
      row.name,
      row.category,
      row.price.toString(),
      row.billingCycle,
      row.status,
      row.renewalDate,
      row.email,
    ]);

    const csvContent = generateSafeCSV(headers, rows);
    downloadCSV(csvContent, "subscriptions-export");

    onToast({
      title: "Export successful",
      description: `${selectedSubs.length} subscription(s) exported to CSV`,
      variant: "success",
    });
  }, [selectedSubscriptions, subscriptions, onToast]);

  const handleBulkCancel = useCallback(() => {
    if (selectedSubscriptions.size === 0) return;

    onShowDialog({
      title: "Cancel selected subscriptions?",
      description: `Are you sure you want to cancel ${selectedSubscriptions.size} subscription(s)? They will remain active until their renewal date.`,
      variant: "warning",
      confirmLabel: "Cancel All",
      onConfirm: async () => {
        setBulkActionLoading(true);
        onShowDialog(null);

        try {
          const selectedIds = Array.from(selectedSubscriptions) as number[];

          for (const id of selectedIds) {
            const sub = subscriptions.find((s) => s.id === id);
            if (sub) {
              const daysUntilRenewal = sub.renewsIn ?? 0;
              const activeUntil = new Date(
                Date.now() + daysUntilRenewal * 24 * 60 * 60 * 1000
              );

              await updateSubscription(id, {
                status: "cancelled",
                cancelled_at: new Date().toISOString(),
                active_until: activeUntil.toISOString(),
              });
            }
          }

          const updatedSubs = subscriptions.map((sub) => {
            if (selectedSubscriptions.has(sub.id)) {
              const daysUntilRenewal = sub.renewsIn ?? 0;
              const activeUntil = new Date(
                Date.now() + daysUntilRenewal * 24 * 60 * 60 * 1000
              );
              return {
                ...sub,
                status: "cancelled",
                cancelledAt: new Date().toISOString(),
                activeUntil: activeUntil.toISOString(),
              };
            }
            return sub;
          });

          updateSubscriptions(updatedSubs);
          addToHistory(updatedSubs);

          const count = selectedSubscriptions.size;
          setSelectedSubscriptions(new Set());

          onToast({
            title: "Subscriptions cancelled",
            description: `${count} subscription(s) have been cancelled`,
            variant: "success",
          });
        } catch (error) {
          onToast({
            title: "Error",
            description: "Failed to cancel subscriptions",
            variant: "error",
          });
        } finally {
          setBulkActionLoading(false);
        }
      },
      onCancel: () => onShowDialog(null),
    });
  }, [
    selectedSubscriptions,
    subscriptions,
    updateSubscriptions,
    addToHistory,
    setSelectedSubscriptions,
    setBulkActionLoading,
    onToast,
    onShowDialog,
  ]);

  const handleBulkPause = useCallback(() => {
    if (selectedSubscriptions.size === 0) return;

    onShowDialog({
      title: "Pause selected subscriptions?",
      description: `Are you sure you want to pause ${selectedSubscriptions.size} subscription(s)? They will be paused for 30 days.`,
      variant: "warning",
      confirmLabel: "Pause All",
      onConfirm: async () => {
        setBulkActionLoading(true);
        onShowDialog(null);

        try {
          const selectedIds = Array.from(selectedSubscriptions) as number[];

          for (const id of selectedIds) {
            await updateSubscription(id, {
              status: "paused",
              paused_at: new Date().toISOString(),
              resumes_at: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
              ).toISOString(),
            });
          }

          const updatedSubs = subscriptions.map((sub) => {
            if (selectedSubscriptions.has(sub.id)) {
              return {
                ...sub,
                status: "paused",
                pausedAt: new Date().toISOString(),
                resumesAt: new Date(
                  Date.now() + 30 * 24 * 60 * 60 * 1000
                ).toISOString(),
              };
            }
            return sub;
          });

          updateSubscriptions(updatedSubs);
          addToHistory(updatedSubs);

          const count = selectedSubscriptions.size;
          setSelectedSubscriptions(new Set());

          onToast({
            title: "Subscriptions paused",
            description: `${count} subscription(s) have been paused for 30 days`,
            variant: "success",
          });
        } catch (error) {
          onToast({
            title: "Error",
            description: "Failed to pause subscriptions",
            variant: "error",
          });
        } finally {
          setBulkActionLoading(false);
        }
      },
      onCancel: () => onShowDialog(null),
    });
  }, [
    selectedSubscriptions,
    subscriptions,
    updateSubscriptions,
    addToHistory,
    setSelectedSubscriptions,
    setBulkActionLoading,
    onToast,
    onShowDialog,
  ]);

  return {
    handleBulkDelete,
    handleBulkExport,
    handleBulkCancel,
    handleBulkPause,
  };
}
