import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import DashboardClient from "../../components/dashboard-client"
import { mockUser } from "../test-utils/factories"

// Mock SuggestionsPanel to avoid issues with its internal logic
vi.mock("@/components/app/SuggestionsPanel", () => ({
  SuggestionsPanel: () => <div data-testid="suggestions-panel">Suggestions</div>,
}))

describe("DashboardClient", () => {
  const user = mockUser() as any
  const defaultProps = {
    initialSubscriptions: [],
    initialEmailAccounts: [],
    initialTeamMembers: [],
    initialNotifications: [],
    initialProfile: { full_name: "Test User" },
    user: user,
  }

  it("renders correctly with no errors", () => {
    render(<DashboardClient {...defaultProps} />)
    expect(screen.queryByText(/Partial data load/i)).not.toBeInTheDocument()
    expect(screen.getByText(/No subscriptions yet/i)).toBeInTheDocument()
  })

  it("renders partial data load warning when errors are present", () => {
    const propsWithErrors = {
      ...defaultProps,
      errors: { notifications: { message: "Failed to load notifications" } },
    }
    render(<DashboardClient {...propsWithErrors} />)
    expect(screen.getByText(/Partial data load/i)).toBeInTheDocument()
  })

  it("renders error state for subscriptions section", () => {
    const propsWithErrors = {
      ...defaultProps,
      errors: { subscriptions: { message: "Failed to load subscriptions" } },
    }
    render(<DashboardClient {...propsWithErrors} />)
    expect(screen.getByText(/Failed to load subscriptions/i)).toBeInTheDocument()
    // The stats should also show "Error"
    expect(screen.getAllByText(/Error/i).length).toBeGreaterThan(0)
  })

  it("renders error state in stats row for team members", () => {
    const propsWithErrors = {
      ...defaultProps,
      errors: { teamMembers: { message: "Failed to load team members" } },
    }
    render(<DashboardClient {...propsWithErrors} />)
    expect(screen.getByText(/Team Members/i).parentElement).toHaveTextContent(/Error/i)
  })
})

