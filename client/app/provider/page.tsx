"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ProviderRoute = {
  id: string;
  name: string;
  model: string;
  status: "active" | "paused";
};

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; routes: ProviderRoute[] };

async function fetchRoutes(): Promise<ProviderRoute[]> {
  const res = await fetch("/api/provider/routes");
  if (!res.ok) {
    const requestId = res.headers.get("x-request-id") ?? undefined;
    throw Object.assign(new Error("Failed to load routes"), { requestId });
  }
  return (await res.json()) as ProviderRoute[];
}

function RoutesSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function RoutesEmpty({ onAddRoute }: { onAddRoute: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm font-medium">No routes yet</p>
      <p className="text-sm text-muted-foreground">
        Add a route to start sending requests to a model provider.
      </p>
      <Button onClick={onAddRoute}>Add a route</Button>
    </div>
  );
}

function RoutesError({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
      <p className="text-sm font-medium">Couldn’t load routes</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      {requestId ? (
        <p className="text-xs text-muted-foreground">
          Request ID: <code>{requestId}</code>
        </p>
      ) : null}
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export default function ProviderPage() {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const routes = await fetchRoutes();
      setState({ status: "ready", routes });
    } catch (err) {
      const error = err as Error & { requestId?: string };
      setState({
        status: "error",
        message: error.message || "Something went wrong.",
        requestId: error.requestId,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Provider console</h1>
        <p className="text-sm text-muted-foreground">
          Manage the routes that connect your agents to model providers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Routes</CardTitle>
          <CardDescription>Model routes available to your agents.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.status === "loading" ? <RoutesSkeleton /> : null}
          {state.status === "error" ? (
            <RoutesError
              message={state.message}
              requestId={state.requestId}
              onRetry={() => void load()}
            />
          ) : null}
          {state.status === "ready" && state.routes.length === 0 ? (
            <RoutesEmpty onAddRoute={() => void load()} />
          ) : null}
          {state.status === "ready" && state.routes.length > 0 ? (
            <ul className="divide-y">
              {state.routes.map((route) => (
                <li key={route.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{route.name}</p>
                    <p className="text-xs text-muted-foreground">{route.model}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{route.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
