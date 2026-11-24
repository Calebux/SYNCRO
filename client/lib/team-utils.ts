import { TeamMember, TeamSubscription, EmailAccount } from "./types";

export function canChangeRole(members: TeamMember[], memberId: number, newRole: string): { allowed: boolean; reason?: string } {
  const member = members.find((m) => m.id === memberId);
  if (!member) return { allowed: false, reason: "Member not found" };

  const adminCount = members.filter((m) => m.role === "Admin" && m.status === "active").length;
  if (member.role === "Admin" && newRole !== "Admin" && adminCount <= 1) {
    return { allowed: false, reason: "Cannot change role: You must have at least one admin in the team. Promote another member to admin first." };
  }

  return { allowed: true };
}

export function canRemoveMember(members: TeamMember[], memberId: number): { allowed: boolean; reason?: string } {
  const member = members.find((m) => m.id === memberId);
  if (!member) return { allowed: false, reason: "Member not found" };

  const adminCount = members.filter((m) => m.role === "Admin" && m.status === "active").length;
  if (member.role === "Admin" && adminCount <= 1) {
    return { allowed: false, reason: "Cannot remove last admin: You must have at least one admin in the team. Promote another member to admin first." };
  }

  return { allowed: true };
}

export function getFilteredEmailAccounts(member: TeamMember, showWorkEmailsOnly: boolean): EmailAccount[] {
  if (showWorkEmailsOnly) {
    return member.emailAccounts.filter((acc) => acc.isWorkEmail);
  }
  return member.emailAccounts;
}

export function getFilteredSubscriptions(member: TeamMember, showWorkEmailsOnly: boolean): TeamSubscription[] {
  if (showWorkEmailsOnly) {
    const workEmails = member.emailAccounts.filter((acc) => acc.isWorkEmail).map((acc) => acc.email);
    return member.subscriptions.filter((sub) => workEmails.includes(sub.email));
  }
  return member.subscriptions;
}
