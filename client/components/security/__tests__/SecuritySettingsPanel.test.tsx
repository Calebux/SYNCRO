import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import SecuritySettingsPanel from "../SecuritySettingsPanel"
import { createClient } from "@/lib/supabase/client"
import { apiPost, apiDelete, apiPut } from "@/lib/api"

// Mock dependencies
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn().mockResolvedValue({}),
  apiDelete: vi.fn().mockResolvedValue({}),
  apiPut: vi.fn().mockResolvedValue({}),
}))

describe("SecuritySettingsPanel", () => {
  let supabase: any

  beforeEach(() => {
    vi.clearAllMocks()
    supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
        mfa: {
          listFactors: vi.fn().mockResolvedValue({ data: { totp: [] }, error: null }),
          challenge: vi.fn(),
          verify: vi.fn(),
          unenroll: vi.fn(),
        },
      },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }
    vi.mocked(createClient).mockReturnValue(supabase)
  })

  it("renders correctly when 2FA is disabled", () => {
    render(
      <SecuritySettingsPanel
        twoFaEnabled={false}
        twoFaEnabledAt={null}
        factorId={null}
        isTeamOwner={false}
        teamId={null}
        teamRequires2fa={false}
      />
    )

    expect(screen.getByText("Two-Factor Authentication")).toBeDefined()
    expect(screen.getByText("Disabled")).toBeDefined()
    expect(screen.getByRole("button", { name: /Enable 2FA/i })).toBeDefined()
  })

  it("renders correctly when 2FA is enabled", () => {
    render(
      <SecuritySettingsPanel
        twoFaEnabled={true}
        twoFaEnabledAt="2024-01-01T00:00:00Z"
        factorId="f1"
        isTeamOwner={false}
        teamId={null}
        teamRequires2fa={false}
      />
    )

    expect(screen.getByText("Enabled")).toBeInTheDocument()
    expect(screen.getByText(/since/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Disable 2FA/i })).toBeDefined()
  })

  it("shows confirmation step when clicking Disable 2FA", () => {
    render(
      <SecuritySettingsPanel
        twoFaEnabled={true}
        twoFaEnabledAt="2024-01-01T00:00:00Z"
        factorId="f1"
        isTeamOwner={false}
        teamId={null}
        teamRequires2fa={false}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Disable 2FA/i }))

    expect(screen.getByText(/Enter your current TOTP code/i)).toBeDefined()
    expect(screen.getByRole("button", { name: /Confirm/i })).toBeDefined()
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeDefined()
  })

  it("handles successful 2FA disable with TOTP code", async () => {
    supabase.auth.mfa.challenge.mockResolvedValue({ data: { id: "c1" }, error: null })
    supabase.auth.mfa.verify.mockResolvedValue({ error: null })
    supabase.auth.mfa.unenroll.mockResolvedValue({ error: null })
    supabase.from.mockReturnThis()
    supabase.update.mockReturnThis()
    supabase.eq.mockResolvedValue({ error: null })

    render(
      <SecuritySettingsPanel
        twoFaEnabled={true}
        twoFaEnabledAt="2024-01-01T00:00:00Z"
        factorId="f1"
        isTeamOwner={false}
        teamId={null}
        teamRequires2fa={false}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Disable 2FA/i }))
    fireEvent.change(screen.getByPlaceholderText(/TOTP code or recovery code/i), {
      target: { value: "123456" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Confirm/i }))

    await waitFor(() => {
      expect(supabase.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: "f1" })
      expect(supabase.auth.mfa.verify).toHaveBeenCalledWith({
        factorId: "f1",
        challengeId: "c1",
        code: "123456",
      })
      expect(supabase.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: "f1" })
      expect(screen.getByText("Disabled")).toBeDefined()
    })
  })

  it("renders team enforcement toggle for owners", async () => {
    render(
      <SecuritySettingsPanel
        twoFaEnabled={true}
        twoFaEnabledAt="2024-01-01T00:00:00Z"
        factorId="f1"
        isTeamOwner={true}
        teamId="t1"
        teamRequires2fa={false}
      />
    )

    expect(screen.getByText(/Require 2FA for all team members/i)).toBeDefined()
    const toggle = screen.getByLabelText(/Enable 2FA requirement for team/i)
    
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith("/api/teams/t1/require-2fa", { required: true })
    })
  })

  it("prevents disabling 2FA if required by team", () => {
    render(
      <SecuritySettingsPanel
        twoFaEnabled={true}
        twoFaEnabledAt="2024-01-01T00:00:00Z"
        factorId="f1"
        isTeamOwner={false}
        teamId="t1"
        teamRequires2fa={true}
      />
    )

    const disableBtn = screen.getByRole("button", { name: /Disable 2FA/i })
    expect(disableBtn).toBeDisabled()
    expect(screen.getByText(/Required by your team/i)).toBeDefined()
  })
})

