"use client";

import { useCallback } from "react";
import type { Subscription } from "@/lib/supabase/subscriptions";
import type {
  NotificationActionHandler,
  NotificationDuplicateInfo,
} from "@/lib/notification-types";
import type { ConfirmationDialog } from "./use-confirmation-dialog";
import type { Toast } from "./use-toast";

interface UseNotificationActionsProps {
  subscriptions: Subscription[];
  updateSubscriptions: (subs: Subscription[]) => void;
  addToHistory: (subs: Subscription[]) => void;
  onCancelSubscription: (id: number) => void;
  onShowDialog: (dialog: ConfirmationDialog | null) => void;
  onToast: (toast: Omit<Toast, "id">) => void;
  onShowInsightsPage: () => void;
}

export function useNotificationActions({
  subscriptions,
  updateSubscriptions,
  addToHistory,
  onCancelSubscription,
  onShowDialog,
  onToast,
  onShowInsightsPage,
}: UseNotificationActionsProps) {
  const handleResolveNotificationAction = useCallback<NotificationActionHandler>(
    (action, data) => {
      console.log("[v0] Resolving notification action:", action, data);

      switch (action) {
        case "resolve_duplicate": {
          const duplicateInfo = data as NotificationDuplicateInfo;
          const subsToKeep = duplicateInfo.subscriptions[0];
          const subsToRemove = duplicateInfo.subscriptions.slice(1);

          onShowDialog({
            title: "Resolve duplicate subscriptions?",
            description: `This will keep ${subsToKeep.name} and remove ${subsToRemove.length} duplicate(s). You'll save $${duplicateInfo.potentialSavings}/month.`,
            variant: "warning",
            confirmLabel: "Resolve",
            onConfirm: () => {
              const idsToRemove = subsToRemove.map((s: Subscription) => s.id);
              const updatedSubs = subscriptions.filter(
                (sub) => !idsToRemove.includes(sub.id)
              );
              updateSubscriptions(updatedSubs);
              addToHistory(updatedSubs);
              onShowDialog(null);

              onToast({
                title: "Duplicate resolved",
                description: `Removed ${subsToRemove.length} duplicate subscription(s). Saving $${duplicateInfo.potentialSavings}/month`,
                variant: "success",
              });
            },
            onCancel: () => onShowDialog(null),
          });
          break;
        }

        case "cancel_unused": {
          const subscriptionId = data as number;
          const unusedSub = subscriptions.find((s) => s.id === subscriptionId);
          if (unusedSub) {
            onShowDialog({
              title: "Cancel unused subscription?",
              description: `Cancel ${unusedSub.name}? It hasn't been used in over 30 days.`,
              variant: "warning",
              confirmLabel: "Cancel Subscription",
              onConfirm: () => {
                onCancelSubscription(subscriptionId);
                onShowDialog(null);
                onToast({
                  title: "Subscription cancelled",
                  description: "Unused subscription has been cancelled",
                  variant: "success",
                });
              },
              onCancel: () => onShowDialog(null),
            });
          }
          break;
        }

        case "cancel_trial": {
          const subscriptionId = data as number;
          const trialSub = subscriptions.find((s) => s.id === subscriptionId);
          if (trialSub) {
            onShowDialog({
              title: "Cancel trial subscription?",
              description: `Cancel ${trialSub.name} before you're charged $${
                trialSub.price_after_trial ||
                trialSub.trial_converts_to_price ||
                0
              }?`,
              variant: "warning",
              confirmLabel: "Cancel Trial",
              onConfirm: () => {
                onCancelSubscription(subscriptionId);
                onShowDialog(null);
                onToast({
                  title: "Trial cancelled",
                  description:
                    "Trial subscription has been cancelled before charge",
                  variant: "success",
                });
              },
              onCancel: () => onShowDialog(null),
            });
          }
          break;
        }

        case "view_consolidation":
          onShowInsightsPage();
          break;

        default:
          console.warn(`[v0] Unknown notification action: ${action}`);
          break;
      }
    },
    [
      subscriptions,
      updateSubscriptions,
      addToHistory,
      onCancelSubscription,
      onShowDialog,
      onToast,
      onShowInsightsPage,
    ]
  );

  return {
    handleResolveNotificationAction,
  };
}
