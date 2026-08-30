import { describe, it, expect } from "vitest";
import { canChangeRole, canRemoveMember } from "../team-utils";
import { TeamMember } from "../types";

const mockMember = (id: number, role: string, status: string = "active"): TeamMember => ({
  id,
  name: `User ${id}`,
  email: `user${id}@example.com`,
  role,
  department: "Engineering",
  permissions: [],
  status,
  toolsUsed: 0,
  monthlySpend: 0,
  emailAccounts: [],
  subscriptions: []
});

describe("team-utils", () => {
  describe("canRemoveMember", () => {
    it("should allow removing a non-admin", () => {
      const members = [
        mockMember(1, "Admin"),
        mockMember(2, "Member"),
      ];
      const result = canRemoveMember(members, 2);
      expect(result.allowed).toBe(true);
    });

    it("should allow removing an admin if there are other active admins", () => {
      const members = [
        mockMember(1, "Admin"),
        mockMember(2, "Admin"),
      ];
      const result = canRemoveMember(members, 1);
      expect(result.allowed).toBe(true);
    });

    it("should not allow removing the last active admin", () => {
      const members = [
        mockMember(1, "Admin"),
        mockMember(2, "Member"),
      ];
      const result = canRemoveMember(members, 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Cannot remove last admin");
    });

    it("should not allow removing the only active admin even if inactive admins exist", () => {
      const members = [
        mockMember(1, "Admin", "active"),
        mockMember(2, "Admin", "inactive"),
      ];
      const result = canRemoveMember(members, 1);
      expect(result.allowed).toBe(false);
    });
  });

  describe("canChangeRole", () => {
    it("should allow a non-admin to change their role", () => {
      const members = [
        mockMember(1, "Admin"),
        mockMember(2, "Member"),
      ];
      const result = canChangeRole(members, 2, "Viewer");
      expect(result.allowed).toBe(true);
    });

    it("should allow an admin to change their role if another active admin exists", () => {
      const members = [
        mockMember(1, "Admin"),
        mockMember(2, "Admin"),
      ];
      const result = canChangeRole(members, 1, "Member");
      expect(result.allowed).toBe(true);
    });

    it("should not allow the last active admin to change their role", () => {
      const members = [
        mockMember(1, "Admin"),
        mockMember(2, "Member"),
      ];
      const result = canChangeRole(members, 1, "Member");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Cannot change role");
    });
  });
});
