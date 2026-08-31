// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth } from "../use-auth";

vi.mock("../../lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost } from "../../lib/api";

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(apiGet).mockResolvedValue({ user: null });
  });

  it("should initialize with default state", async () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.authError).toBeNull();
    expect(result.current.authLoading).toBe(false);
  });

  it("should set isAuthenticated to true when user is returned", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      user: { email: "test@example.com" },
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.showLandingAuth).toBe(false);
  });

  it("should show onboarding when user is authenticated and onboarding not completed", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      user: { email: "test@example.com" },
    });
    localStorage.removeItem("onboarding_completed");

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.showOnboarding).toBe(true);
    });
  });

  it("should not show onboarding when already completed", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      user: { email: "test@example.com" },
    });
    localStorage.setItem("onboarding_completed", "true");

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.showOnboarding).toBe(false);
  });

  it("should set authError on failed login", async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error("Invalid credentials"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.handleLogin("test@example.com", "wrongpassword");
    });

    expect(result.current.authError).toBe("Invalid credentials");
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("should set isAuthenticated on successful login", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      user: { email: "test@example.com" },
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.handleLogin("test@example.com", "password123");
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.authError).toBeNull();
  });

  it("should set authenticated state on handleSignup", () => {
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.handleSignup();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.showOnboarding).toBe(true);
  });
});
