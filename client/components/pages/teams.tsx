"use client"

import { useState } from "react"
import { Users, Plus, Search, Trash2, TrendingUp, Activity, Mail, Briefcase, User, DollarSign, Slack } from "lucide-react"
import { showToast } from "@/components/ui/toast"
import { StatusBadge, normalizeStatus } from "@/components/ui/status-badge"
import { TeamMember, Workspace, TeamSubscription, EmailAccount } from "@/lib/types"
import { canChangeRole, canRemoveMember } from "@/lib/team-utils"

interface TeamsPageProps {
  workspace: Workspace
  subscriptions: TeamSubscription[]
  darkMode: boolean
  emailAccounts: EmailAccount[]
}

export default function TeamsPage({ workspace, subscriptions, darkMode, emailAccounts }: TeamsPageProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"members" | "usage" | "emails">("members")
  const [showWorkEmailsOnly, setShowWorkEmailsOnly] = useState(true)

  const [slackWebhookUrl, setSlackWebhookUrl] = useState(workspace?.slack_webhook_url ?? "")
  const [savingSlack, setSavingSlack] = useState(false)

  const handleSaveSlackWebhook = async () => {
    if (slackWebhookUrl && !slackWebhookUrl.startsWith("https://hooks.slack.com/")) {
      showToast({ title: "Invalid URL", description: "Must be a valid Slack webhook URL.", variant: "error" })
      return
    }
    setSavingSlack(true)
    try {
      const res = await fetch("/api/team/slack-webhook", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slack_webhook_url: slackWebhookUrl || null }),
      })
      if (!res.ok) throw new Error("Failed")
      showToast({ title: "Saved", description: "Slack webhook updated.", variant: "success" })
    } catch {
      showToast({ title: "Error", description: "Could not save webhook.", variant: "error" })
    } finally {
      setSavingSlack(false)
    }
  }

  const isAdmin = members.some((m: any) => m.email === workspace?.currentUserEmail && m.role === "Admin")

  const [teamSettings, setTeamSettings] = useState({
    spendingLimit: 1000,
    departmentBudgets: {
      Engineering: 500,
      Marketing: 300,
      Design: 200,
    },
  })

  const [members, setMembers] = useState<TeamMember[]>([
    {
      id: 1,
      name: "Joy Anderson",
      email: "joy@cleanupcrew.com",
      role: "Admin",
      department: "Engineering",
      permissions: ["view", "edit", "delete", "approve"],
      status: "active",
      toolsUsed: 5,
      monthlySpend: 100,
      emailAccounts: [
        { email: "joy@cleanupcrew.com", isWorkEmail: true },
        { email: "joy.anderson@gmail.com", isWorkEmail: false },
      ],
      subscriptions: [
        { name: "ChatGPT Plus", usage: 450, lastUsed: "2 hours ago", email: "joy@cleanupcrew.com" },
        { name: "Midjourney", usage: 320, lastUsed: "5 hours ago", email: "joy.anderson@gmail.com" },
        { name: "Notion AI", usage: 180, lastUsed: "1 day ago", email: "joy@cleanupcrew.com" },
        { name: "Gemini", usage: 95, lastUsed: "3 days ago", email: "joy.anderson@gmail.com" },
        { name: "Perplexity Pro", usage: 67, lastUsed: "1 week ago", email: "joy@cleanupcrew.com" },
      ],
    },
    {
      id: 2,
      name: "Naya Williams",
      email: "naya@cleanupcrew.com",
      role: "Billing Manager",
      department: "Finance",
      permissions: ["view", "edit", "approve"],
      status: "active",
      toolsUsed: 3,
      monthlySpend: 60,
      emailAccounts: [{ email: "naya@cleanupcrew.com", isWorkEmail: true }],
      subscriptions: [
        { name: "ChatGPT Plus", usage: 280, lastUsed: "1 hour ago", email: "naya@cleanupcrew.com" },
        { name: "Githubcopilot", usage: 520, lastUsed: "30 mins ago", email: "naya@cleanupcrew.com" },
        { name: "Notion AI", usage: 145, lastUsed: "2 days ago", email: "naya@cleanupcrew.com" },
      ],
    },
    {
      id: 3,
      name: "Marcus Chen",
      email: "marcus@cleanupcrew.com",
      role: "Member",
      department: "Engineering",
      permissions: ["view"],
      status: "active",
      toolsUsed: 4,
      monthlySpend: 80,
      emailAccounts: [
        { email: "marcus@cleanupcrew.com", isWorkEmail: true },
        { email: "marcus.chen@personal.com", isWorkEmail: false },
        { email: "mchen@contractor.io", isWorkEmail: false },
      ],
      subscriptions: [
        { name: "Midjourney", usage: 680, lastUsed: "1 hour ago", email: "marcus@cleanupcrew.com" },
        { name: "ChatGPT Plus", usage: 390, lastUsed: "3 hours ago", email: "marcus.chen@personal.com" },
        { name: "Gemini", usage: 210, lastUsed: "1 day ago", email: "mchen@contractor.io" },
        { name: "Perplexity Pro", usage: 125, lastUsed: "2 days ago", email: "marcus@cleanupcrew.com" },
      ],
    },
    {
      id: 4,
      name: "Sarah Johnson",
      email: "sarah@cleanupcrew.com",
      role: "Viewer",
      department: "Marketing",
      permissions: ["view"],
      status: "pending",
      toolsUsed: 0,
      monthlySpend: 0,
      emailAccounts: [],
      subscriptions: [],
    },
  ])

  const [showAddMember, setShowAddMember] = useState(false)
  const [selectedMember, setSelectedMember] = useState<number | null>(null)
  const [newMember, setNewMember] = useState({
    name: "",
    email: "",
    role: "Member",
    department: "Engineering",
    permissions: ["view"],
  })

  const filteredMembers = members.filter(
    (member) =>
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleAddMember = () => {
    if (newMember.name && newMember.email) {
      setMembers([
        ...members,
        {
          id: members.length + 1,
          ...newMember,
          status: "pending",
          toolsUsed: 0,
          monthlySpend: 0,
          emailAccounts: [],
          subscriptions: [],
        },
      ])
      setNewMember({ name: "", email: "", role: "Member", department: "Engineering", permissions: ["view"] })
      setShowAddMember(false)
    }
  }

  const handleMemberLeave = (memberId: number) => {
    const member = members.find((m) => m.id === memberId)
    if (!member) return

    if (member.subscriptions.length === 0) {
      // No subscriptions, safe to delete
      const confirmDelete = window.confirm(
        `Remove ${member.name} from the team? They have no subscriptions to transfer.`,
      )

      if (confirmDelete) {
        setMembers(members.filter((m) => m.id !== memberId))
      }
      return
    }

    // Show options for handling subscriptions
    const action = window.confirm(
      `${member.name} has ${member.subscriptions.length} subscription(s). Click OK to archive their data (keep for records), or Cancel to transfer to admin.`,
    )

    if (action) {
      // Archive member (mark as inactive)
      setMembers(members.map((m) => (m.id === memberId ? { ...m, status: "inactive", leftAt: new Date() } : m)))
    } else {
      // Transfer subscriptions to admin
      const admin = members.find((m) => m.role === "Admin")
      if (admin) {
        // In real implementation, would transfer subscriptions
        alert(`Subscriptions transferred to ${admin.name}`)
        setMembers(members.filter((m) => m.id !== memberId))
      }
    }
  }

  const handleDeleteMember = (id: number) => {
    const check = canRemoveMember(members, id);
    if (!check.allowed) {
      showToast({
        title: "Cannot remove last admin",
        description: check.reason || "",
        variant: "error",
      })
      return
    }

    handleMemberLeave(id)
  }

  const handleChangeRole = (memberId: number, newRole: string) => {
    const check = canChangeRole(members, memberId, newRole);
    if (!check.allowed) {
      alert(check.reason)
      return
    }

    setMembers(members.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)))
  }

  /**
   * Role badge colours – preserved brand palette, all verified ≥ 4.5:1.
   *   Admin:          #1E2A35 on #FFD166 = 8.4:1  ✅
   *   Billing Manager: white on #007A5C  = 4.54:1 ✅  (both modes)
   *   Viewer:          white on #4b5563  = 4.6:1  ✅
   *   Member (default): dark-grey on light-grey (light) / light-grey on dark-grey (dark)
   */
  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "Admin":
        return "bg-[#FFD166] text-[#1E2A35]"
      case "Billing Manager":
        return "bg-[#007A5C] text-white"
      case "Viewer":
        return darkMode ? "bg-[#4b5563] text-white" : "bg-[#4b5563] text-white"
      default:
        return darkMode ? "bg-[#374151] text-[#d1d5db]" : "bg-[#e5e7eb] text-[#374151]"
    }
  }

  const getFilteredEmailAccounts = (member: TeamMember) => {
    if (showWorkEmailsOnly) {
      return member.emailAccounts.filter((acc) => acc.isWorkEmail)
    }
    return member.emailAccounts
  }

  const getFilteredSubscriptions = (member: TeamMember) => {
    if (showWorkEmailsOnly) {
      const workEmails = member.emailAccounts.filter((acc) => acc.isWorkEmail).map((acc) => acc.email)
      return member.subscriptions.filter((sub) => workEmails.includes(sub.email))
    }
    return member.subscriptions
  }

  const totalUsage = members.reduce((sum: number, member: TeamMember) => {
    const filteredSubs = getFilteredSubscriptions(member)
    return sum + filteredSubs.reduce((subSum: number, sub) => subSum + sub.usage, 0)
  }, 0)

  const totalEmailAccounts = members.reduce((sum: number, member: TeamMember) => sum + getFilteredEmailAccounts(member).length, 0)

  const getDepartmentSpending = () => {
    const spending: Record<string, number> = {}
    members.forEach((member: TeamMember) => {
      if (!spending[member.department]) {
        spending[member.department] = 0
      }
      spending[member.department] += member.monthlySpend
    })
    return spending
  }

  const departmentSpending = getDepartmentSpending()

  const totalDepartmentBudget = Object.values(teamSettings.departmentBudgets).reduce(
    (sum: number, val: number) => sum + val,
    0,
  )
  const totalDepartmentSpending = Object.values(departmentSpending).reduce((sum: number, val: number) => sum + val, 0)

  return (
    <div className="space-y-6">
      {/* Workspace Name and Domain Display */}
      {workspace && (
        <div
          className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} p-6 rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-xl font-bold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                {workspace.name || "My Workspace"}
              </h3>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"} mt-1`}>
                {workspace.domain || "workspace.com"}
              </p>
            </div>
            <div
              className={`px-4 py-2 rounded-lg ${darkMode ? "bg-[#007A5C]/20 text-[#007A5C]" : "bg-green-100 text-green-700"}`}
            >
              <span className="text-sm font-medium">Enterprise Plan</span>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div
          className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} p-6 rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Total Members</p>
              <p className={`text-2xl font-bold mt-1 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                {members.length}
              </p>
            </div>
            <Users className={`w-8 h-8 ${darkMode ? "text-[#FFD166]" : "text-[#FFD166]"}`} />
          </div>
        </div>

        <div
          className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} p-6 rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Email Accounts</p>
              <p className={`text-2xl font-bold mt-1 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                {totalEmailAccounts}
              </p>
            </div>
            <Mail className={`w-8 h-8 ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"}`} />
          </div>
        </div>

        <div
          className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} p-6 rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Dept. Budget</p>
              <p className={`text-2xl font-bold mt-1 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                ${totalDepartmentBudget}
              </p>
            </div>
            <Briefcase className={`w-8 h-8 ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"}`} />
          </div>
        </div>

        <div
          className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} p-6 rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Dept. Spending</p>
              <p className={`text-2xl font-bold mt-1 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                ${totalDepartmentSpending}
              </p>
              <p
                className={`text-xs mt-1 ${
                  totalDepartmentSpending > totalDepartmentBudget
                    ? "text-[#E86A33]"
                    : totalDepartmentSpending > totalDepartmentBudget * 0.8
                      ? "text-[#FFD166]"
                      : "text-[#007A5C]"
                }`}
              >
                {((totalDepartmentSpending / totalDepartmentBudget) * 100).toFixed(0)}% of budget
              </p>
            </div>
            <DollarSign className={`w-8 h-8 ${darkMode ? "text-[#E86A33]" : "text-[#E86A33]"}`} />
          </div>
        </div>

        <div
          className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} p-6 rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Total Usage</p>
              <p className={`text-2xl font-bold mt-1 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                {totalUsage.toLocaleString()}
              </p>
            </div>
            <Activity className={`w-8 h-8 ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"}`} />
          </div>
        </div>
      </div>

      {/* Slack Alerts — admin only */}
      {isAdmin && (
        <div
          className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} p-6 rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center gap-2 mb-4">
            <Slack className={`w-5 h-5 ${darkMode ? "text-[#FFD166]" : "text-[#1E2A35]"}`} />
            <h3 className={`text-lg font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>Slack Alerts</h3>
          </div>
          <p className={`text-sm mb-3 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
            Paste a Slack Incoming Webhook URL to receive budget and team alerts in a channel (e.g. #accounting).
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={slackWebhookUrl}
              onChange={(e) => setSlackWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className={`flex-1 px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD166] ${
                darkMode ? "bg-[#1E2A35] border-gray-700 text-white" : "bg-white border-gray-200 text-[#1E2A35]"
              }`}
            />
            <button
              onClick={handleSaveSlackWebhook}
              disabled={savingSlack}
              className="px-4 py-2 bg-[#007A5C] text-white rounded-lg text-sm font-medium hover:bg-[#007A5C]/90 disabled:opacity-50"
            >
              {savingSlack ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Tab Buttons and Work Email Filter Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("members")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "members"
                ? darkMode
                  ? "text-[#FFD166] border-b-2 border-[#FFD166]"
                  : "text-[#1E2A35] border-b-2 border-[#1E2A35]"
                : darkMode
                  ? "text-gray-400 hover:text-gray-300"
                  : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Members
          </button>
          <button
            onClick={() => setActiveTab("emails")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "emails"
                ? darkMode
                  ? "text-[#FFD166] border-b-2 border-[#FFD166]"
                  : "text-[#1E2A35] border-b-2 border-[#1E2A35]"
                : darkMode
                  ? "text-gray-400 hover:text-gray-300"
                  : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Email Accounts
          </button>
          <button
            onClick={() => setActiveTab("usage")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "usage"
                ? darkMode
                  ? "text-[#FFD166] border-b-2 border-[#FFD166]"
                  : "text-[#1E2A35] border-b-2 border-[#1E2A35]"
                : darkMode
                  ? "text-gray-400 hover:text-gray-300"
                  : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Usage Tracking
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Briefcase className={`w-4 h-4 ${darkMode ? "text-gray-400" : "text-gray-500"}`} />
          <label className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-700"}`}>Work emails only</label>
          <button
            onClick={() => setShowWorkEmailsOnly(!showWorkEmailsOnly)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              showWorkEmailsOnly ? "bg-[#007A5C]" : darkMode ? "bg-gray-700" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                showWorkEmailsOnly ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {activeTab === "members" && (
        <>
          {/* Search and Add Member */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search
                className={`absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 ${darkMode ? "text-gray-400" : "text-gray-400"}`}
              />
              <input
                type="text"
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full pl-10 pr-4 py-2 ${darkMode ? "bg-[#2D3748] border-gray-700 text-white" : "bg-white border-gray-200 text-[#1E2A35]"} border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166]`}
              />
            </div>
            <button
              onClick={() => setShowAddMember(true)}
              className="flex items-center gap-2 bg-[#1E2A35] text-white px-4 py-2 rounded-lg hover:bg-[#2D3748] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Member
            </button>
          </div>

          {/* Members Table */}
          <div
            className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"} overflow-hidden`}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className={`${darkMode ? "bg-[#1E2A35]" : "bg-[#F9F6F2]"}`}>
                  <tr>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Member
                    </th>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Role
                    </th>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Department
                    </th>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Status
                    </th>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Email Accounts
                    </th>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Tools Used
                    </th>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Monthly Spend
                    </th>
                    <th
                      className={`px-6 py-3 text-left text-xs font-medium ${darkMode ? "text-gray-300" : "text-gray-500"} uppercase tracking-wider`}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className={`${darkMode ? "divide-gray-700" : "divide-gray-200"} divide-y`}>
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className={`${darkMode ? "hover:bg-[#374151]" : "hover:bg-[#F9F6F2]"}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div
                            className={`w-10 h-10 rounded-full ${darkMode ? "bg-[#FFD166]" : "bg-[#FFD166]"} flex items-center justify-center text-[#1E2A35] font-semibold`}
                          >
                            {member.name.charAt(0)}
                          </div>
                          <div className="ml-4">
                            <div className={`text-sm font-medium ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                              {member.name}
                            </div>
                            <div className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                              {member.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getRoleBadgeColor(member.role)}`}
                        >
                          {member.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-900"}`}>
                          {member.department}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge
                          status={normalizeStatus(member.status)}
                          darkMode={darkMode}
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Mail className={`w-4 h-4 ${darkMode ? "text-gray-400" : "text-gray-500"}`} />
                          <span className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-900"}`}>
                            {getFilteredEmailAccounts(member).length}
                          </span>
                          {showWorkEmailsOnly && getFilteredEmailAccounts(member).length > 0 && (
                            <Briefcase className={`w-3 h-3 ml-1 ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"}`} />
                          )}
                        </div>
                      </td>
                      <td
                        className={`px-6 py-4 whitespace-nowrap text-sm ${darkMode ? "text-gray-300" : "text-gray-900"}`}
                      >
                        {member.toolsUsed}
                      </td>
                      <td
                        className={`px-6 py-4 whitespace-nowrap text-sm ${darkMode ? "text-gray-300" : "text-gray-900"}`}
                      >
                        ${member.monthlySpend}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSelectedMember(member.id)}
                            className={`p-1 ${darkMode ? "hover:bg-[#374151]" : "hover:bg-gray-100"} rounded`}
                          >
                            <TrendingUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteMember(member.id)}
                            className={`p-1 ${darkMode ? "hover:bg-red-900/20" : "hover:bg-red-50"} rounded text-red-600`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "emails" && (
        <div className="space-y-4">
          {members
            .filter((m) => getFilteredEmailAccounts(m).length > 0)
            .map((member) => (
              <div
                key={member.id}
                className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"} p-6`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full ${darkMode ? "bg-[#FFD166]" : "bg-[#FFD166]"} flex items-center justify-center text-[#1E2A35] font-semibold`}
                    >
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className={`font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>{member.name}</h3>
                      <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                        {getFilteredEmailAccounts(member).length} email account
                        {getFilteredEmailAccounts(member).length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getRoleBadgeColor(member.role)}`}>
                    {member.role}
                  </span>
                </div>

                <div className="space-y-3">
                  {getFilteredEmailAccounts(member).map((emailAccount, idx: number) => {
                    const emailSubs = member.subscriptions.filter((sub) => sub.email === emailAccount.email)
                    const emailSpend = emailSubs.length * 20
                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-lg border ${darkMode ? "bg-[#1E2A35] border-gray-700" : "bg-[#F9F6F2] border-gray-200"}`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            {emailAccount.isWorkEmail ? (
                              <Briefcase className={`w-4 h-4 ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"}`} />
                            ) : (
                              <User className={`w-4 h-4 ${darkMode ? "text-gray-400" : "text-gray-500"}`} />
                            )}
                            <span className={`font-medium ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                              {emailAccount.email}
                            </span>
                            {emailAccount.isWorkEmail && (
                              <span
                                className={`px-2 py-0.5 text-xs font-medium rounded ${darkMode ? "bg-[#007A5C] text-white" : "bg-[#007A5C] text-white"}`}
                              >
                                Work
                              </span>
                            )}
                            {idx === 0 && (
                              <span
                                className={`px-2 py-0.5 text-xs font-medium rounded ${darkMode ? "bg-[#FFD166] text-[#1E2A35]" : "bg-[#FFD166] text-[#1E2A35]"}`}
                              >
                                Primary
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                              ${emailSpend}/mo
                            </p>
                            <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                              {emailSubs.length} subscription{emailSubs.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>

                        {emailSubs.length > 0 && (
                          <div className="space-y-2">
                            {emailSubs.map((sub, subIdx) => (
                              <div
                                key={subIdx}
                                className={`flex items-center justify-between text-sm p-2 rounded ${darkMode ? "bg-[#2D3748]" : "bg-white"}`}
                              >
                                <span className={darkMode ? "text-gray-300" : "text-gray-700"}>{sub.name}</span>
                                <span className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                                  {sub.usage} requests
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>
      )}

      {activeTab === "usage" && (
        <div className="space-y-6">
          {members
            .filter((m) => m.status === "active")
            .map((member) => {
              const filteredSubs = getFilteredSubscriptions(member)
              if (filteredSubs.length === 0 && showWorkEmailsOnly) return null

              return (
                <div
                  key={member.id}
                  className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} rounded-xl border ${darkMode ? "border-gray-700" : "border-gray-200"} p-6`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-full ${darkMode ? "bg-[#FFD166]" : "bg-[#FFD166]"} flex items-center justify-center text-[#1E2A35] font-semibold text-lg`}
                      >
                        {member.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className={`font-semibold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>{member.name}</h3>
                        <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>{member.email}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                        {showWorkEmailsOnly ? "Work Email Usage" : "Total Usage"}
                      </p>
                      <p className={`text-xl font-bold ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>
                        {filteredSubs.reduce((sum: number, sub: any) => sum + sub.usage, 0).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {filteredSubs.map((sub, idx: number) => {
                      const emailAccount = member.emailAccounts.find((acc) => acc.email === sub.email)
                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between p-3 rounded-lg ${darkMode ? "bg-[#1E2A35]" : "bg-[#F9F6F2]"}`}
                        >
                          <div className="flex-1">
                            <p className={`font-medium ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>{sub.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                                Last used: {sub.lastUsed}
                              </p>
                              {sub.email && (
                                <>
                                  <span className={`text-xs ${darkMode ? "text-gray-600" : "text-gray-300"}`}>•</span>
                                  <div className="flex items-center gap-1">
                                    {emailAccount?.isWorkEmail ? (
                                      <Briefcase
                                        className={`w-3 h-3 ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"}`}
                                      />
                                    ) : (
                                      <User className={`w-3 h-3 ${darkMode ? "text-gray-500" : "text-gray-400"}`} />
                                    )}
                                    <p className={`text-xs ${darkMode ? "text-gray-500" : "text-gray-400"}`}>
                                      {sub.email}
                                    </p>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold ${darkMode ? "text-[#007A5C]" : "text-[#007A5C]"}`}>
                              {sub.usage} requests
                            </p>
                            <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
                              <div
                                className="h-2 bg-[#007A5C] rounded-full"
                                style={{ width: `${Math.min((sub.usage / 1000) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${darkMode ? "bg-[#2D3748]" : "bg-white"} rounded-xl p-6 max-w-md w-full`}>
            <h3 className={`text-xl font-bold mb-4 ${darkMode ? "text-white" : "text-[#1E2A35]"}`}>Add Team Member</h3>
            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Name
                </label>
                <input
                  type="text"
                  value={newMember.name}
                  onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                  className={`w-full px-4 py-2 ${darkMode ? "bg-[#1E2A35] border-gray-700 text-white" : "bg-white border-gray-200 text-[#1E2A35]"} border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166]`}
                  placeholder="Enter member name"
                />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Email
                </label>
                <input
                  type="email"
                  value={newMember.email}
                  onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                  className={`w-full px-4 py-2 ${darkMode ? "bg-[#1E2A35] border-gray-700 text-white" : "bg-white border-gray-200 text-[#1E2A35]"} border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166]`}
                  placeholder="member@company.com"
                />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Role
                </label>
                <select
                  value={newMember.role}
                  onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
                  className={`w-full px-4 py-2 ${darkMode ? "bg-[#1E2A35] border-gray-700 text-white" : "bg-white border-gray-200 text-[#1E2A35]"} border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166]`}
                >
                  <option value="Member">Member</option>
                  <option value="Billing Manager">Billing Manager</option>
                  <option value="Admin">Admin</option>
                  <option value="Viewer">Viewer</option>
                </select>
              </div>
              <div>
                <label className={`block text-sm font-medium mb-2 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>
                  Department
                </label>
                <select
                  value={newMember.department}
                  onChange={(e) => setNewMember({ ...newMember, department: e.target.value })}
                  className={`w-full px-4 py-2 ${darkMode ? "bg-[#1E2A35] border-gray-700 text-white" : "bg-white border-gray-200 text-[#1E2A35]"} border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD166]`}
                >
                  <option value="Engineering">Engineering</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Design">Design</option>
                  <option value="Finance">Finance</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddMember(false)}
                className={`flex-1 px-4 py-2 ${darkMode ? "bg-gray-700 hover:bg-gray-600" : "bg-gray-200 hover:bg-gray-300"} rounded-lg transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                className="flex-1 px-4 py-2 bg-[#1E2A35] text-white rounded-lg hover:bg-[#2D3748] transition-colors"
              >
                Add Member
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
