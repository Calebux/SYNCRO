"use client";

/**
 * DataStates – unified empty, loading, and error states for data components.
 *
 * Provides consistent state handling across all data-driven components
 * (tables, lists, charts, metric grids, etc.) in both principal and
 * provider consoles.
 */

import * as React from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { Alert, AlertTitle, AlertDescription } from "./alert";
import { Button } from "./button";
import { RefreshCw, AlertTriangle, Search, Filter, Database, WifiOff, ShieldAlert } from "lucide-react";

export type DataState = "idle" | "loading" | "error" | "empty" | "success";

export interface DataStateConfig {
  /** Loading state */
  loading?: {
    /** Number of skeleton rows/items to show */
    count?: number;
    /** Custom loading message */
    message?: string;
    /** Show as overlay vs inline */
    overlay?: boolean;
  };
  /** Empty state */
  empty?: {
    /** Icon (emoji or Lucide name) */
    icon?: string;
    /** Title */
    title?: string;
    /** Description */
    description?: string;
    /** Action button */
    action?: { label: string; onClick: () => void; variant?: "default" | "outline" | "ghost" };
    /** Empty state variant */
    variant?: "default" | "search" | "filter" | "permission" | "offline";
  };
  /** Error state */
  error?: {
    /** Title */
    title?: string;
    /** Description */
    description?: string;
    /** Retry action */
    onRetry?: () => void;
    /** Retry button label */
    retryLabel?: string;
    /** Error variant */
    variant?: "default" | "network" | "permission" | "server" | "not-found";
  };
  /** Success state (for after mutations) */
  success?: {
    /** Message */
    message: string;
    /** Duration in ms before auto-dismiss */
    duration?: number;
    /** Action on dismiss */
    onDismiss?: () => void;
  };
}

const emptyStateVariants: Record<string, { icon: string; title: string; description: string }> = {
  default: { icon: "📭", title: "No data", description: "There's nothing to show here yet." },
  search: { icon: Search, title: "No results", description: "Try adjusting your search or filters." },
  filter: { icon: Filter, title: "No matches", description: "No items match your current filters." },
  permission: { icon: ShieldAlert, title: "Access denied", description: "You don't have permission to view this data." },
  offline: { icon: WifiOff, title: "Offline", description: "Check your connection and try again." },
};

const errorVariants: Record<string, { title: string; description: string; icon: React.ComponentType }> = {
  default: { title: "Something went wrong", description: "An unexpected error occurred.", icon: AlertTriangle },
  network: { title: "Connection error", description: "Unable to reach the server. Check your network.", icon: WifiOff },
  permission: { title: "Access denied", description: "You don't have permission to perform this action.", icon: ShieldAlert },
  server: { title: "Server error", description: "The server encountered an error. Please try again later.", icon: Database },
  "not-found": { title: "Not found", description: "The requested resource doesn't exist.", icon: AlertTriangle },
};

interface DataStatesProps {
  /** Current data state */
  state: DataState;
  /** Error message (when state === 'error') */
  error?: Error | string | null;
  /** Configuration for each state */
  config?: DataStateConfig;
  /** Children to render when state === 'success' */
  children: React.ReactNode;
  /** Custom className */
  className?: string;
  /** Test ID for testing */
  testId?: string;
}

export function DataStates({
  state,
  error,
  config = {},
  children,
  className,
  testId,
}: DataStatesProps) {
  const { loading, empty, error: errorConfig, success } = config;

  // Loading state
  if (state === "loading") {
    const count = loading?.count ?? 5;
    const message = loading?.message ?? "Loading...";
    const overlay = loading?.overlay ?? false;

    const skeletonRows = Array.from({ length: count }).map((_, i) => (
      <div key={i} className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    ));

    if (overlay) {
      return (
        <div className={cn("relative", className)} data-testid={testId}>
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3 p-6">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">{message}</span>
            </div>
          </div>
          <div className="pointer-events-none opacity-50">{children}</div>
        </div>
      );
    }

    return (
      <div className={cn("flex flex-col gap-3", className)} data-testid={testId} role="status" aria-live="polite">
        {skeletonRows}
        <p className="text-sm text-muted-foreground text-center py-4">{message}</p>
      </div>
    );
  }

  // Error state
  if (state === "error") {
    const variant = errorConfig?.variant ?? "default";
    const { title, description, icon: Icon } = errorVariants[variant];
    const displayTitle = errorConfig?.title ?? title;
    const displayDescription = errorConfig?.description ?? (typeof error === "string" ? error : error?.message ?? description);
    const onRetry = errorConfig?.onRetry;
    const retryLabel = errorConfig?.retryLabel ?? "Try again";

    return (
      <div className={cn("w-full", className)} data-testid={testId} role="alert">
        <Alert variant="destructive" className="w-full">
          <Icon className="w-5 h-5" />
          <div className="grid gap-1">
            <AlertTitle>{displayTitle}</AlertTitle>
            <AlertDescription>{displayDescription}</AlertDescription>
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} className="mt-3 w-full sm:w-auto">
              <RefreshCw className="w-4 h-4 mr-2" />
              {retryLabel}
            </Button>
          )}
        </Alert>
      </div>
    );
  }

  // Empty state
  if (state === "empty") {
    const variant = empty?.variant ?? "default";
    const variantConfig = emptyStateVariants[variant] ?? emptyStateVariants.default;
    const icon = empty?.icon ?? variantConfig.icon;
    const title = empty?.title ?? variantConfig.title;
    const description = empty?.description ?? variantConfig.description;
    const action = empty?.action;

    return (
      <div className={cn("w-full", className)} data-testid={testId}>
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          action={action ? { label: action.label, onClick: action.onClick } : undefined}
        />
      </div>
    );
  }

  // Success state (transient, shows message then renders children)
  if (state === "success" && success) {
    return (
      <div className={cn("relative", className)} data-testid={testId}>
        <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
          <Alert className="bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800 max-w-sm">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <AlertTitle className="text-green-800 dark:text-green-200">Success</AlertTitle>
            </div>
            <AlertDescription className="text-green-700 dark:text-green-300">{success.message}</AlertDescription>
          </Alert>
        </div>
        {children}
      </div>
    );
  }

  // Idle/success - render children
  return <div className={cn(className)} data-testid={testId}>{children}</div>;
}

DataStates.displayName = "DataStates";

/**
 * Hook for managing data state in components.
 */
export function useDataState<T>(
  fetchFn: () => Promise<T>,
  options: {
    initialState?: DataState;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
    config?: DataStateConfig;
  } = {}
) {
  const { initialState = "idle", onSuccess, onError, config } = options;
  const [state, setState] = React.useState<DataState>(initialState);
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const isMounted = React.useRef(true);

  React.useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const execute = React.useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const result = await fetchFn();
      if (!isMounted.current) return;
      setData(result);
      setState("success");
      onSuccess?.(result);
      // Auto-transition to idle after success duration
      if (config?.success?.duration) {
        setTimeout(() => {
          if (isMounted.current) setState("idle");
        }, config.success.duration);
      }
    } catch (err) {
      if (!isMounted.current) return;
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setState("error");
      onError?.(error);
    }
  }, [fetchFn, onSuccess, onError, config?.success?.duration]);

  const retry = React.useCallback(() => {
    execute();
  }, [execute]);

  const reset = React.useCallback(() => {
    setState("idle");
    setData(null);
    setError(null);
  }, []);

  return { state, data, error, execute, retry, reset, setState, setData };
}

/**
 * Compound component for data-driven UI with built-in states.
 * Usage:
 *   <DataComponent
 *     fetchFn={fetchData}
 *     render={(data) => <Table data={data} />}
 *     config={{ empty: { variant: 'search' }, error: { onRetry: refetch } }}
 *   />
 */
interface DataComponentProps<T> {
  /** Async function to fetch data */
  fetchFn: () => Promise<T[]>;
  /** Render function for success state */
  render: (data: T[]) => React.ReactNode;
  /** Initial state */
  initialState?: DataState;
  /** State configuration */
  config?: DataStateConfig;
  /** Dependencies to trigger refetch */
  deps?: React.DependencyList;
  /** Manual trigger */
  trigger?: number;
  /** Children as render prop alternative */
  children?: (data: T[]) => React.ReactNode;
}

export function DataComponent<T>({
  fetchFn,
  render,
  initialState = "idle",
  config,
  deps = [],
  trigger,
  children,
}: DataComponentProps<T>) {
  const { state, data, error, execute, retry } = useDataState(
    async () => {
      const result = await fetchFn();
      return result;
    },
    { initialState, config }
  );

  // Auto-fetch on mount and deps change
  React.useEffect(() => {
    if (initialState !== "idle" || trigger !== undefined) {
      execute();
    }
  }, [execute, initialState, trigger, ...deps]);

  const renderFn = children ?? render;

  return (
    <DataStates state={state} error={error} config={config} testId="data-component">
      {state === "success" && data && renderFn(data)}
      {state === "idle" && data && renderFn(data)}
    </DataStates>
  );
}

DataComponent.displayName = "DataComponent";

/**
 * Pre-configured state configs for common scenarios.
 */
export const dataStatePresets = {
  /** Table with search */
  tableSearch: {
    empty: { variant: "search" as const },
    error: { variant: "default" as const, onRetry: () => {} },
  } satisfies DataStateConfig,
  /** Table with filters */
  tableFilter: {
    empty: { variant: "filter" as const },
    error: { variant: "default" as const, onRetry: () => {} },
  } satisfies DataStateConfig,
  /** Dashboard metric */
  metric: {
    loading: { count: 1, overlay: true },
    empty: { variant: "default" as const, title: "No data", description: "—" },
    error: { variant: "default" as const, title: "Failed to load metric" },
  } satisfies DataStateConfig,
  /** Chart */
  chart: {
    loading: { count: 1, overlay: true, message: "Rendering chart..." },
    empty: { variant: "default" as const, title: "No chart data", description: "Insufficient data to render chart." },
    error: { variant: "default" as const, title: "Chart error" },
  } satisfies DataStateConfig,
  /** List */
  list: {
    loading: { count: 3 },
    empty: { variant: "default" as const },
    error: { variant: "default" as const, onRetry: () => {} },
  } satisfies DataStateConfig,
};

export { DataStates, useDataState, DataComponent, dataStatePresets };
export type { DataState, DataStateConfig, DataComponentProps };