/**
 * Email Accounts API client
 * 
 * Provides API functions for email account operations.
 * These functions are used by the query hooks to interact with the backend.
 */

import type { EmailAccount, CreateEmailAccountInput } from "@/hooks/use-email-accounts";

/**
 * Fetch all email accounts for the current user
 */
export async function fetchEmailAccounts(): Promise<EmailAccount[]> {
  const response = await fetch("/api/email-accounts", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch email accounts: ${response.statusText}`);
  }

  const data = await response.json();
  return normalizeEmailAccounts(data.emailAccounts || data || []);
}

/**
 * Create a new email account
 */
export async function createEmailAccount(
  account: CreateEmailAccountInput
): Promise<EmailAccount> {
  const response = await fetch("/api/email-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(account),
  });

  if (!response.ok) {
    throw new Error(`Failed to create email account: ${response.statusText}`);
  }

  const data = await response.json();
  return normalizeEmailAccount(data.emailAccount || data);
}

/**
 * Delete an email account
 */
export async function deleteEmailAccount(id: number): Promise<void> {
  const response = await fetch(`/api/email-accounts/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete email account: ${response.statusText}`);
  }
}

/**
 * Update an email account
 */
export async function updateEmailAccount(
  id: number,
  updates: Partial<EmailAccount>
): Promise<EmailAccount> {
  const response = await fetch(`/api/email-accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error(`Failed to update email account: ${response.statusText}`);
  }

  const data = await response.json();
  return normalizeEmailAccount(data.emailAccount || data);
}

/**
 * Normalize email account data from API response
 */
function normalizeEmailAccount(account: any): EmailAccount {
  return {
    ...account,
    isPrimary: Boolean(account.isPrimary ?? account.is_primary ?? false),
  };
}

/**
 * Normalize array of email accounts from API response
 */
function normalizeEmailAccounts(accounts: any[]): EmailAccount[] {
  return accounts.map(normalizeEmailAccount);
}
