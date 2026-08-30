"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { queryConfig } from "@/lib/query-config";

/**
 * QueryProvider wraps the application with TanStack React Query context.
 * 
 * This provider is mounted in the root layout and makes the shared query client
 * available throughout the application. The query client uses centralized
 * configuration defined in lib/query-config.ts.
 * 
 * Usage: This provider is already integrated in app/layout.tsx.
 * Individual hooks should use useQuery/useMutation to access the shared query layer.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: queryConfig,
      })
  );
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
