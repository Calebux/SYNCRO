"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

interface FeedEvent {
  id: string;
  type: string;
  message: string;
  ts: number;
}

const EVENT_LABELS: Record<string, string> = {
  subscription_created: "New Subscription Found",
  payment_confirmed: "Payment Confirmed",
  subscription_cancelled: "Subscription Cancelled",
  subscription_renewed: "Subscription Renewed",
};

const MAX_EVENTS = 20;

export function EventFeed({ userId }: { userId: string }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const channelRef = useRef<ReturnType<typeof getSupabaseBrowserClient>["channel"] | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`event-feed:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; event_type: string; metadata?: any; created_at: string };
          const label = EVENT_LABELS[row.event_type] ?? row.event_type;
          setEvents((prev) =>
            [
              {
                id: row.id,
                type: row.event_type,
                message: label,
                ts: Date.now(),
              },
              ...prev,
            ].slice(0, MAX_EVENTS)
          );
        }
      )
      .subscribe();

    channelRef.current = channel as any;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  if (events.length === 0) {
    return (
      <div className="text-sm text-gray-400 py-4 text-center">
        Waiting for events…
      </div>
    );
  }

  return (
    <ul className="space-y-2 max-h-64 overflow-y-auto">
      {events.map((ev) => (
        <li
          key={`${ev.id}-${ev.ts}`}
          className="flex items-center gap-3 text-sm animate-in slide-in-from-top-2 duration-300"
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              ev.type === "payment_confirmed"
                ? "bg-green-500"
                : ev.type === "subscription_cancelled"
                ? "bg-red-500"
                : "bg-blue-500"
            }`}
          />
          <span className="text-gray-200">{ev.message}</span>
          <span className="ml-auto text-gray-500 text-xs">
            {new Date(ev.ts).toLocaleTimeString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
