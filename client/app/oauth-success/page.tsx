"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { LoadingSpinner } from "@syncro/ui";

export default function OAuthSuccessPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      // Add a small delay to ensure cookie is set by backend
      await new Promise(resolve => setTimeout(resolve, 500));
      
      try {
        // Check if user is authenticated - try multiple times if needed
        let res;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
          try {
            res = await apiGet("/api/auth/me");
            if (res?.user) {
              break;
            }
          } catch (err) {
            console.debug(`Auth check attempt ${attempts + 1} failed:`, err);
          }
          
          attempts++;
          if (attempts < maxAttempts) {
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        if (res?.user) {
          setStatus("success");
          console.log("✅ Authentication successful:", res.user.email);
          
          // Store auth success flag to help with state persistence
          sessionStorage.setItem("oauth_success", "true");
          sessionStorage.setItem("user_email", res.user.email);
          
          // Check if onboarding is completed
          const onboardingCompleted = localStorage.getItem("onboarding_completed");
          
          // Add a small delay before redirect to ensure state is saved
          setTimeout(() => {
            if (!onboardingCompleted) {
              // Redirect to home (which will show onboarding via app-client)
              // Force a full page reload to ensure cookie is available
              window.location.href = "/";
            } else {
              // Redirect to dashboard
              window.location.href = "/dashboard";
            }
          }, 300);
        } else {
          setStatus("error");
          setError("Authentication failed. The cookie may not have been set properly. Please try again.");
          console.error("❌ Auth check failed - no user in response:", res);
        }
      } catch (err) {
        console.error("OAuth success check failed:", err);
        setStatus("error");
        setError("Failed to verify authentication. Please check your browser console for details.");
        
        // Redirect to home after a delay
        setTimeout(() => {
          window.location.href = "/";
        }, 5000);
      }
    };

    checkAuthAndRedirect();
  }, [router]);

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F6F2]">
        <div className="text-center">
          <LoadingSpinner size="lg" darkMode={false} />
          <p className="mt-4 text-gray-600">Completing sign in...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9F6F2]">
        <div className="text-center max-w-md p-6">
          <div className="text-red-600 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign In Failed</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9F6F2]">
      <div className="text-center">
        <LoadingSpinner size="lg" darkMode={false} />
        <p className="mt-4 text-gray-600">Redirecting...</p>
      </div>
    </div>
  );
}

