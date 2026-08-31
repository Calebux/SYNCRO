"use client";

import { useState, useEffect, useCallback } from "react";
import {
  checkRenewalReminders,
  detectDuplicates,
  detectUnusedSubscriptions,
} from "@/lib/subscription-utils";
import type { Subscription } from "@/lib/supabase/subscriptions";
import type { BudgetAlert } from "@/lib/budget-utils";
import type { Notification } from "@/lib/notification-types";

interface UseNotificationsProps {
  subscriptions: Subscription[];
  priceChanges: any[];
  renewalReminders: any[];
  consolidationSuggestions: any[];
  budgetAlert: BudgetAlert | null;
}

export function useNotifications({
  subscriptions,
  priceChanges,
  renewalReminders,
  consolidationSuggestions,
  budgetAlert,
}: UseNotificationsProps) {
  const [readIds, setReadIds] = useState<Set<string | number>>(new Set());

  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: 1,
      title: "Duplicate Subscription Detected",
      description:
        "You have 2 ChatGPT Plus accounts across different emails - Potential savings: $20/month",
      type: "duplicate",
      read: false,
      duplicateInfo: {
        name: "ChatGPT Plus",
        count: 2,
        totalCost: 40,
        potentialSavings: 20,
        subscriptions: [{ id: 1, name: "ChatGPT Plus" }],
      },
    },
    {
      id: 2,
      title: "Unused AI Tool",
      description:
        "Midjourney hasn't been used in 35 days - Consider canceling to save $30/month",
      type: "unused",
      read: false,
      subscriptionId: 7,
    },
    {
      id: 3,
      title: "Spend Increases",
      description:
        "Your spend increased 18% this month - mostly from image generation tools",
      type: "info",
      read: false,
    },
    {
      id: 4,
      title: "New Detection",
      description:
        "We detected a new Perplexity Pro subscription in your email",
      type: "alert",
      read: false,
      detectedSubscription: {
        name: "Perplexity Pro",
        category: "AI Tools",
        price: 20,
        logo: "https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/perplexity-ai-icon.png",
        tags: ["search", "ai"],
        renewsIn: 30,
        status: "active",
        icon: "🔍",
        color: "#000000",
        renewalUrl: "https://www.perplexity.ai/settings/subscription",
        emailAccountId: 1,
      },
    },
  ]);

  // Load persisted read state on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("syncro_read_notifications");
      if (saved) {
        setReadIds(new Set(JSON.parse(saved)));
      }
    } catch (e) {
      console.error("Failed to parse read notifications from localStorage");
    }
  }, []);

  useEffect(() => {
    const newNotifications: Notification[] = [];

    // Price change notifications
    priceChanges.forEach((change) => {
      newNotifications.push({
        id: `price_${change.id}`,
        title: "Price Increase Detected",
        description: `${change.name} increased from $${change.oldPrice} to $${change.newPrice} (+$${change.annualImpact}/year)`,
        type: "price_change",
        read: false,
        priceChangeInfo: change,
      });
    });

    // Renewal reminder notifications
    renewalReminders.forEach((reminder) => {
      newNotifications.push({
        id: `renewal_${reminder.id}`,
        title: "Upcoming Renewal",
        description: `${reminder.name} renews in ${reminder.renewsIn} day${
          reminder.renewsIn !== 1 ? "s" : ""
        } ($${reminder.price})`,
        type: "renewal",
        read: false,
        subscriptionId: reminder.id,
      });
    });

    // Budget alert notifications
    if (budgetAlert) {
      newNotifications.push({
        id: "budget_alert",
        title:
          budgetAlert.level === "critical"
            ? "Budget Exceeded"
            : "Budget Warning",
        description: budgetAlert.message,
        type: "budget",
        read: false,
      });
    }

    // Consolidation suggestion notifications
    consolidationSuggestions.forEach((suggestion) => {
      newNotifications.push({
        id: `consolidation_${suggestion.id}`,
        title: "Consolidation Opportunity",
        description: `You have ${suggestion.services.length} ${suggestion.category} services - Consider ${suggestion.suggestedBundle} and save $${suggestion.savings}/month`,
        type: "consolidation",
        read: false,
        suggestionId: suggestion.id,
      });
    });

    // Merge with existing notifications (avoid duplicates)
    setNotifications((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      const uniqueNew = newNotifications.filter((n) => !existingIds.has(n.id));
      return [...prev, ...uniqueNew];
    });
  }, [priceChanges, renewalReminders, budgetAlert, consolidationSuggestions]);

  const handleMarkNotificationRead = useCallback((id: Notification["id"]) => {
    setReadIds((prev) => {
      const newSet = new Set(prev);
      newSet.add(id);
      localStorage.setItem("syncro_read_notifications", JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  }, []);

  const processedNotifications = notifications.map((n) => ({
    ...n,
    read: n.read || readIds.has(n.id),
  }));

  const unreadNotifications = processedNotifications.filter((n) => !n.read).length;

  return {
    notifications: processedNotifications,
    unreadNotifications,
    handleMarkNotificationRead,
  };
}
