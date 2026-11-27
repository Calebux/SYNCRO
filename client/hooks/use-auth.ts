"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost } from "../lib/api";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showLandingAuth, setShowLandingAuth] = useState(true); // Show landing page with Google button
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Function to manually refresh auth state
  const refreshAuth = useCallback(async () => {
    try {
      const res = await apiGet("/api/auth/me");
      if (res?.user) {
        setIsAuthenticated(true);
        setShowLandingAuth(false);
        const onboardingCompleted = localStorage.getItem("onboarding_completed");
        if (!onboardingCompleted) {
          setShowOnboarding(true);
        }
        return true;
      } else {
        setIsAuthenticated(false);
        setShowLandingAuth(true);
        return false;
      }
    } catch (error) {
      console.debug("Auth refresh failed:", error);
      setIsAuthenticated(false);
      setShowLandingAuth(true);
      return false;
    }
  }, []);

  // Check authentication status on mount by calling backend
  useEffect(() => {
    const checkAuth = async () => {
      // If we just came from OAuth success, add a small delay
      const oauthSuccess = sessionStorage.getItem("oauth_success");
      if (oauthSuccess) {
        // Clear the flag
        sessionStorage.removeItem("oauth_success");
        // Add delay to ensure cookie is available
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      try {
        const res = await apiGet("/api/auth/me");
        if (res?.user) {
          console.log("✅ User authenticated:", res.user.email);
          setIsAuthenticated(true);
          setShowLandingAuth(false);
          // Keep existing onboarding flow (frontend still uses onboarding flag stored locally)
          const onboardingCompleted = localStorage.getItem(
            "onboarding_completed"
          );
          if (!onboardingCompleted) {
            setShowOnboarding(true);
          }
        } else {
          // Not authenticated - show landing page with Google button
          console.debug("❌ No user in auth response");
          setShowLandingAuth(true);
        }
      } catch (error: unknown) {
        // Not authenticated or failed to reach API - show landing page with Google button
        console.debug("Auth check failed:", error);
        setShowLandingAuth(true);
      }
    };
    checkAuth();
  }, []);

  const handleLogin = useCallback(
    async (email: string, password: string, onSuccess?: () => void) => {
      setAuthLoading(true);
      setAuthError(null);
      try {
        // Simulate API call - replace with actual Supabase auth
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Call backend login endpoint. Backend will set HTTP-only cookie.
        const data = await apiPost("/api/auth/login", { email, password });
        if (data?.user) {
          setIsAuthenticated(true);
          setShowLandingAuth(false);
          setShowOnboarding(false); // Skip onboarding for existing users
          onSuccess?.();
        } else {
          throw new Error("Invalid login response");
        }
      } catch (error: unknown) {
        setAuthError(
          error instanceof Error
            ? error.message
            : "Failed to sign in. Please try again."
        );
      } finally {
        setAuthLoading(false);
      }
    },
    []
  );

  const handleSignup = useCallback(() => {
    setShowLandingAuth(false);
    setShowOnboarding(true);
    setIsAuthenticated(true); // Set authenticated so they can proceed after onboarding
  }, []);
  const handleSignOut = useCallback(async () => {
    setAuthLoading(true);
    try {
      // Attempt to tell the backend to clear the HTTP-only cookie
      await apiPost("/api/auth/logout", {});
    } catch (error) {
      console.debug("Logout API call failed or endpoint missing:", error);
    } finally {
      // Reset the local UI state regardless of API success
      setIsAuthenticated(false);
      setShowLandingAuth(true);
      setAuthLoading(false);
    }
  }, []);
  // Listen for storage events (when OAuth success sets sessionStorage)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "oauth_success" && e.newValue === "true") {
        // OAuth just completed, refresh auth state
        setTimeout(() => {
          refreshAuth();
        }, 500);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    
    // Also check if oauth_success is already set (same-tab scenario)
    if (sessionStorage.getItem("oauth_success") === "true") {
      setTimeout(() => {
        refreshAuth();
      }, 500);
    }

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [refreshAuth]);

  return {
    isAuthenticated,
    showLandingAuth,
    showOnboarding,
    authError,
    authLoading,
    setIsAuthenticated,
    setShowLandingAuth,
    setShowOnboarding,
    handleLogin,
    handleSignup,
    handleSignOut,
    refreshAuth,
  };
}
