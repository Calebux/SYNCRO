"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@syncro/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report to Sentry
    Sentry.captureException(error);
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#F9F6F2] dark:bg-[#1E2A35] flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold text-[#1E2A35] dark:text-[#F9F6F2]">
            Something went wrong
          </h2>
          <p className="text-[#1E2A35]/70 dark:text-[#F9F6F2]/70">
            {error.message || "An unexpected error occurred. Our team has been notified."}
          </p>
        </div>
        
        {error.digest && (
          <div className="bg-black/5 dark:bg-white/5 py-2 px-4 rounded-md inline-block">
            <p className="text-xs font-mono text-[#1E2A35]/50 dark:text-[#F9F6F2]/50">
              Error ID: {error.digest}
            </p>
          </div>
        )}

        <div className="flex gap-4 justify-center">
          <Button 
            onClick={reset} 
            className="bg-[#E86A33] hover:bg-[#E86A33]/90 text-white px-8"
          >
            Try again
          </Button>
          <Button
            onClick={() => (window.location.href = "/")}
            variant="outline"
            className="border-[#1E2A35]/20 dark:border-[#F9F6F2]/20"
          >
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}

