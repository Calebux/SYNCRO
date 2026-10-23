"use client";

import Link from "next/link";
import { Button } from "@syncro/ui";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F9F6F2] dark:bg-[#1E2A35] flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <div className="text-6xl font-bold text-[#E86A33]">404</div>
          <h2 className="text-3xl font-bold text-[#1E2A35] dark:text-[#F9F6F2]">
            Page Not Found
          </h2>
          <p className="text-[#1E2A35]/70 dark:text-[#F9F6F2]/70">
            The page you are looking for doesn't exist or has been moved.
          </p>
        </div>

        <div className="flex gap-4 justify-center">
          <Button asChild className="bg-[#E86A33] hover:bg-[#E86A33]/90 text-white px-8">
            <Link href="/">Go home</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="border-[#1E2A35]/20 dark:border-[#F9F6F2]/20"
          >
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
