/**
 * Test fixture generator for performance testing with large datasets
 */

export interface GeneratedSubscription {
  id: string;
  name: string;
  price: number;
  status: "active" | "expiring" | "expired";
  renewsIn: number;
  category: string;
  lastRenewalDate: Date;
  renewalDate: Date;
  currency: string;
}

export interface GeneratedAuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  timestamp: Date;
}

const SUBSCRIPTION_NAMES = [
  "Netflix",
  "Spotify",
  "Adobe Creative Cloud",
  "Microsoft 365",
  "GitHub Pro",
  "AWS",
  "Google Workspace",
  "Slack",
  "Figma",
  "Notion",
  "Linear",
  "Vercel",
  "Supabase",
  "Stripe",
  "Auth0",
  "Calendly",
  "Zoom",
  "Discord Nitro",
  "ChatGPT Plus",
  "Claude Pro",
];

const CATEGORIES = [
  "Streaming",
  "Productivity",
  "Development",
  "Design",
  "Communication",
  "Cloud",
];

const AUDIT_ACTIONS = [
  "subscription_created",
  "subscription_renewed",
  "subscription_cancelled",
  "payment_processed",
  "payment_failed",
  "user_login",
  "settings_updated",
  "api_key_generated",
];

/**
 * Generate N subscription records for performance testing
 */
export function generateSubscriptions(count: number): GeneratedSubscription[] {
  const subscriptions: GeneratedSubscription[] = [];

  for (let i = 0; i < count; i++) {
    const name = `${SUBSCRIPTION_NAMES[i % SUBSCRIPTION_NAMES.length]} ${Math.floor(i / SUBSCRIPTION_NAMES.length) + 1}`;
    const price = Math.floor(Math.random() * 300) + 5;
    const statusOptions: Array<"active" | "expiring" | "expired"> = ["active", "expiring", "expired"];
    const status = statusOptions[Math.floor(Math.random() * statusOptions.length)];
    const renewsIn = Math.floor(Math.random() * 90) + 1;
    const renewalDate = new Date();
    renewalDate.setDate(renewalDate.getDate() + renewsIn);

    const lastRenewalDate = new Date();
    lastRenewalDate.setMonth(lastRenewalDate.getMonth() - 1);

    subscriptions.push({
      id: `sub_${i}`,
      name,
      price,
      status,
      renewsIn,
      category: CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
      lastRenewalDate,
      renewalDate,
      currency: "USD",
    });
  }

  return subscriptions;
}

/**
 * Generate N audit log entries for performance testing
 */
export function generateAuditLogs(count: number): GeneratedAuditLog[] {
  const logs: GeneratedAuditLog[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date();
    timestamp.setHours(timestamp.getHours() - Math.floor(Math.random() * 168)); // Last 7 days

    logs.push({
      id: `log_${i}`,
      action: AUDIT_ACTIONS[Math.floor(Math.random() * AUDIT_ACTIONS.length)],
      resource: i % 3 === 0 ? "subscription" : i % 3 === 1 ? "payment" : "api_key",
      resourceId: `res_${Math.floor(Math.random() * 1000)}`,
      details: {
        ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        userAgent: "Mozilla/5.0...",
      },
      timestamp,
    });
  }

  return logs;
}

/**
 * Generate N renewal events for payment history
 */
export interface GeneratedRenewalEvent {
  id: string;
  type: "renewed" | "failed" | "reminder_sent" | "cancelled" | "paused" | "resumed";
  date: Date;
  amount: number;
  status: "success" | "failed" | "pending";
  notes?: string;
}

export function generateRenewalEvents(count: number): GeneratedRenewalEvent[] {
  const events: GeneratedRenewalEvent[] = [];
  const types: Array<GeneratedRenewalEvent["type"]> = [
    "renewed",
    "failed",
    "reminder_sent",
    "cancelled",
    "paused",
    "resumed",
  ];

  for (let i = 0; i < count; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (count - i)); // Spread over time

    events.push({
      id: `event_${i}`,
      type: types[Math.floor(Math.random() * types.length)],
      date,
      amount: Math.floor(Math.random() * 300) + 5,
      status: Math.random() > 0.9 ? "failed" : Math.random() > 0.1 ? "success" : "pending",
      notes: Math.random() > 0.7 ? "Payment processed successfully" : undefined,
    });
  }

  return events;
}
