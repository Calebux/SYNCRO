"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Subscription } from "@/lib/supabase/subscriptions";
import { IntegrationStatus } from "@/lib/integration-types";
import type { Integration } from "@/lib/integration-types";
import type { Toast } from "@/hooks/use-toast";
import { queryKeys } from "@/lib/query-config";
import {
  fetchEmailAccounts,
  createEmailAccount as apiCreateEmailAccount,
  deleteEmailAccount as apiDeleteEmailAccount,
  updateEmailAccount as apiUpdateEmailAccount,
} from "@/lib/api/email-accounts";

export interface EmailAccount {
  id: number;
  email: string;
  isPrimary: boolean;
  lastScanned?: Date;
  [key: string]: unknown;
}

export interface EmailAccountInput {
  id: number;
  email: string;
  isPrimary?: boolean;
  is_primary?: boolean;
  [key: string]: unknown;
}

export type CreateEmailAccountInput = Omit<EmailAccountInput, "id">;

type ToastPayload = Omit<Toast, "id">;

export type EmailLinkedSubscription = Subscription & {
  emailAccountId?: number | null;
  statusNote?: string;
};

function normalizeEmailAccounts(accounts: EmailAccountInput[]): EmailAccount[] {
  return accounts.map((account) => ({
    ...account,
    isPrimary: Boolean(account.isPrimary ?? account.is_primary ?? false),
  }));
}

function isSubscriptionLinkedToEmailAccount(
  subscription: EmailLinkedSubscription,
  emailAccountId: number
): boolean {
  return (
    subscription.emailAccountId === emailAccountId ||
    subscription.email_account_id === emailAccountId
  );
}

interface UseEmailAccountsProps {
  initialAccounts: EmailAccountInput[];
  subscriptions: EmailLinkedSubscription[];
  updateSubscriptions: (subs: EmailLinkedSubscription[]) => void;
  addToHistory: (subs: EmailLinkedSubscription[]) => void;
  onToast: (toast: ToastPayload) => void;
}

export function useEmailAccounts({
  initialAccounts,
  subscriptions,
  updateSubscriptions,
  addToHistory,
  onToast,
}: UseEmailAccountsProps) {
  const queryClient = useQueryClient();

  // Use React Query to manage email accounts data
  const {
    data: emailAccounts = normalizeEmailAccounts(initialAccounts),
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.emailAccounts.lists(),
    queryFn: fetchEmailAccounts,
    initialData: normalizeEmailAccounts(initialAccounts),
    staleTime: 60_000, // Use fresh data for 1 minute
  });

  const [integrations, setIntegrations] = useState<Integration[]>([
    {
      id: 1,
      name: "Gmail",
      type: "Email Integration",
      status: IntegrationStatus.Connected,
      lastSync: "2 minutes ago",
      accounts: initialAccounts.length,
    },
    {
      id: 3,
      name: "Manual tools",
      type: "Self-managed",
      status: IntegrationStatus.Connected,
      lastSync: "2 minutes ago",
      accounts: 0,
    },
  ]);

  // Mutation: Add email account
  const addEmailAccountMutation = useMutation({
    mutationFn: (emailAccountData: CreateEmailAccountInput) => {
      // For now, use optimistic updates since API might not exist yet
      // In production, this would call apiCreateEmailAccount
      const newId =
        emailAccounts.length > 0
          ? Math.max(...emailAccounts.map((acc) => acc.id)) + 1
          : 1;

      return Promise.resolve({
        ...emailAccountData,
        id: newId,
        isPrimary: Boolean(
          emailAccountData.isPrimary ?? emailAccountData.is_primary ?? false
        ),
      });
    },
    onSuccess: (newAccount) => {
      // Invalidate and refetch email accounts
      queryClient.setQueryData(
        queryKeys.emailAccounts.lists(),
        (old: EmailAccount[] = []) => [...old, newAccount]
      );

      setIntegrations((prev) =>
        prev.map((int) =>
          int.name === "Gmail"
            ? { ...int, accounts: emailAccounts.length + 1 }
            : int
        )
      );

      onToast({
        title: "Email account added",
        description: `${newAccount.email} has been successfully connected.`,
        variant: "success",
      });
    },
    onError: (error: Error) => {
      onToast({
        title: "Error adding email account",
        description: error.message,
        variant: "error",
      });
    },
  });

  // Mutation: Remove email account
  const removeEmailAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      // In production, this would call apiDeleteEmailAccount(id)
      return Promise.resolve(id);
    },
    onMutate: async (id: number) => {
      const emailToRemove = emailAccounts.find((acc) => acc.id === id);

      if (!emailToRemove) {
        throw new Error("Email account not found");
      }

      // Prevent deletion of primary email
      if (emailToRemove.isPrimary) {
        const otherEmails = emailAccounts.filter((acc) => acc.id !== id);

        if (otherEmails.length === 0) {
          alert(
            "Cannot delete your last email account. You need at least one email to track subscriptions."
          );
          throw new Error("Cannot delete last email account");
        }

        alert(
          "Cannot delete primary email. Please set another email as primary first."
        );
        throw new Error("Cannot delete primary email");
      }

      // Mark subscriptions from this email as "source_removed"
      const affectedSubscriptions = subscriptions.filter((sub) =>
        isSubscriptionLinkedToEmailAccount(sub, id)
      );

      if (affectedSubscriptions.length > 0) {
        const confirmDelete = window.confirm(
          `This email has ${affectedSubscriptions.length} subscription(s). These will be marked as "source removed" but kept for your records. Continue?`
        );

        if (!confirmDelete) {
          throw new Error("Deletion cancelled by user");
        }

        // Update subscriptions to mark as source_removed
        const updatedSubs = subscriptions.map((sub) =>
          isSubscriptionLinkedToEmailAccount(sub, id)
            ? {
                ...sub,
                status: "source_removed",
                statusNote: `Email ${
                  emailToRemove.email
                } was disconnected on ${new Date().toLocaleDateString()}`,
              }
            : sub
        );
        updateSubscriptions(updatedSubs);
        addToHistory(updatedSubs);
      }

      return { emailToRemove, affectedSubscriptions };
    },
    onSuccess: (id) => {
      // Update query cache
      queryClient.setQueryData(
        queryKeys.emailAccounts.lists(),
        (old: EmailAccount[] = []) => old.filter((acc) => acc.id !== id)
      );

      setIntegrations((prev) =>
        prev.map((int) =>
          int.name === "Gmail"
            ? { ...int, accounts: emailAccounts.length - 1 }
            : int
        )
      );
    },
    onError: (error: Error) => {
      // Only show error toast for non-user-cancelled errors
      if (
        !error.message.includes("cancelled") &&
        !error.message.includes("Cannot delete")
      ) {
        onToast({
          title: "Error removing email account",
          description: error.message,
          variant: "error",
        });
      }
    },
  });

  // Mutation: Set primary email
  const setPrimaryEmailMutation = useMutation({
    mutationFn: async (id: number) => {
      const newPrimary = emailAccounts.find((acc) => acc.id === id);

      if (!newPrimary) {
        throw new Error("Email account not found");
      }

      const confirmChange = window.confirm(
        `Set ${newPrimary.email} as your primary email? This will be used for new subscriptions and notifications.`
      );

      if (!confirmChange) {
        throw new Error("Change cancelled by user");
      }

      // In production, this would call apiUpdateEmailAccount
      return Promise.resolve(id);
    },
    onSuccess: (id) => {
      queryClient.setQueryData(
        queryKeys.emailAccounts.lists(),
        (old: EmailAccount[] = []) =>
          old.map((acc) => ({
            ...acc,
            isPrimary: acc.id === id,
          }))
      );
    },
    onError: (error: Error) => {
      if (!error.message.includes("cancelled")) {
        onToast({
          title: "Error setting primary email",
          description: error.message,
          variant: "error",
        });
      }
    },
  });

  // Mutation: Rescan email
  const rescanEmailMutation = useMutation({
    mutationFn: async (id: number) => {
      // In production, this would trigger a backend rescan
      return Promise.resolve({ id, lastScanned: new Date() });
    },
    onSuccess: ({ id, lastScanned }) => {
      queryClient.setQueryData(
        queryKeys.emailAccounts.lists(),
        (old: EmailAccount[] = []) =>
          old.map((acc) => (acc.id === id ? { ...acc, lastScanned } : acc))
      );
    },
  });

  const handleAddEmailAccount = useCallback(
    (emailAccountData: CreateEmailAccountInput) => {
      addEmailAccountMutation.mutate(emailAccountData);
    },
    [addEmailAccountMutation]
  );

  const handleRemoveEmailAccount = useCallback(
    (id: number) => {
      removeEmailAccountMutation.mutate(id);
    },
    [removeEmailAccountMutation]
  );

  const handleSetPrimaryEmail = useCallback(
    (id: number) => {
      setPrimaryEmailMutation.mutate(id);
    },
    [setPrimaryEmailMutation]
  );

  const handleRescanEmail = useCallback(
    (id: number) => {
      rescanEmailMutation.mutate(id);
    },
    [rescanEmailMutation]
  );

  const handleToggleIntegration = useCallback((id: number) => {
    setIntegrations((prev) =>
      prev.map((int) =>
        int.id === id
          ? {
              ...int,
              status:
                int.status === IntegrationStatus.Connected
                  ? IntegrationStatus.Disconnected
                  : IntegrationStatus.Connected,
            }
          : int
      )
    );
  }, []);

  return {
    emailAccounts,
    integrations,
    isLoading,
    error,
    handleAddEmailAccount,
    handleRemoveEmailAccount,
    handleSetPrimaryEmail,
    handleRescanEmail,
    handleToggleIntegration,
  };
}
