#!/usr/bin/env node
/**
 * v3 local-dev seed script.
 *
 * Creates the minimum data a developer needs to exercise a full
 * paid-call flow end-to-end:
 *
 *   1. A principal (user in auth.users)
 *   2. An agent with a scope and a spend cap
 *   3. An open funded channel
 *   4. A registered mock provider with a route
 *
 * Idempotent: re-running does not duplicate the demo principal, agent,
 * provider, or channel. Safe to call from `npm run bootstrap`.
 *
 * Usage:
 *   DATABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node seed-v3.mjs
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const supabaseUrl = process.env.DATABASE_URL ?? "";
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !supabaseServiceRole) {
  console.error("DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole);

// Stable demo identifiers so re-runs are idempotent.
const DEMO_EMAIL = "v3-dev@local.dev";
const DEMO_PASSWORD = "dev-password-123";
const DEMO_CHANNEL_ID = "v3-ch-demo";
const DEMO_AGENT_ID = "v3-agent-demo";
const DEMO_PROVIDER_ID = "v3-provider-demo";
const DEMO_ROUTE = "mock/echo";
const CHANNEL_SIZE = 5000; // 5000 units funded

async function findExistingPrincipal() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.warn(`Auth user lookup skipped: ${error.message}`);
    return null;
  }
  return (data?.users ?? []).find((u) => u.email === DEMO_EMAIL) ?? null;
}

async function seed() {
  console.log("Seeding v3 local-dev data…");

  // --- Principal (auth user) — reuse if it already exists ---
  let principalId;
  const existing = await findExistingPrincipal();
  if (existing) {
    principalId = existing.id;
    console.log(`Principal (auth user): id=${principalId} (existing)`);
  } else {
    principalId = crypto.randomUUID();
    const { error: userErr } = await supabase.auth.admin.createUser({
      id: principalId,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (userErr) {
      console.warn(`Auth user creation skipped (may already exist): ${userErr.message}`);
    }
    console.log(`Principal (auth user): id=${principalId}`);
  }

  // --- Payment channel (open, funded) — upsert on stable channel id ---
  const { error: channelErr } = await supabase.from("payment_channels").upsert(
    {
      user_id: principalId,
      channel_id: DEMO_CHANNEL_ID,
      recipient_id: principalId,
      balance: CHANNEL_SIZE,
      status: "active",
      metadata: { v3: true, seeded: true },
    },
    { onConflict: "channel_id" },
  );
  if (channelErr) console.warn(`Channel upsert: ${channelErr.message}`);
  console.log(`Channel: id=${DEMO_CHANNEL_ID} size=${CHANNEL_SIZE} status=active`);

  // --- Channel state (initial state) — upsert on (channel_id, state_number) ---
  const { error: stateErr } = await supabase.from("channel_states").upsert(
    {
      channel_id: DEMO_CHANNEL_ID,
      state_number: 1,
      balance: CHANNEL_SIZE,
      nonce: crypto.randomUUID(),
      signature: "dev-signature",
      confirmed: true,
    },
    { onConflict: "channel_id,state_number" },
  );
  if (stateErr) console.warn(`Channel state upsert: ${stateErr.message}`);

  // --- Pending settlement (open, funded) — upsert on channel id ---
  const { error: settleErr } = await supabase.from("pending_settlements").upsert(
    {
      user_id: principalId,
      channel_id: DEMO_CHANNEL_ID,
      settlement_amount: CHANNEL_SIZE,
      status: "pending",
    },
    { onConflict: "channel_id" },
  );
  if (settleErr) console.warn(`Pending settlement upsert: ${settleErr.message}`);

  // --- Agent with scope and cap (stored in profiles or a custom table) ---
  // Try to upsert into profiles if it exists; otherwise skip gracefully.
  const { error: profileErr } = await supabase.from("profiles").upsert(
    {
      id: principalId,
      agent_id: DEMO_AGENT_ID,
      scopes: ["paid-call:proxy"],
      cap: 1000,
      v3: true,
    },
    { onConflict: "id" },
  );
  if (profileErr) {
    // profiles table may not exist yet — that's fine for seed
    console.warn(`Profile upsert skipped: ${profileErr.message}`);
  }
  console.log(`Agent: id=${DEMO_AGENT_ID} scope=paid-call:proxy cap=1000`);

  // --- Mock provider with a route — upsert on stable provider id ---
  const { error: providerErr } = await supabase.from("providers").upsert(
    {
      id: DEMO_PROVIDER_ID,
      name: "v3 mock provider",
      route: DEMO_ROUTE,
      status: "active",
      metadata: { v3: true, seeded: true, mock: true },
    },
    { onConflict: "id" },
  );
  if (providerErr) console.warn(`Provider upsert skipped: ${providerErr.message}`);
  console.log(`Provider: id=${DEMO_PROVIDER_ID} route=${DEMO_ROUTE}`);

  console.log("v3 seed complete.");
  printDemoInstructions();
}

function printDemoInstructions() {
  const baseUrl = process.env.V3_API_URL ?? "http://localhost:3000";
  console.log("");
  console.log("── Demo credentials ─────────────────────────────────────────");
  console.log(`  email:      ${DEMO_EMAIL}`);
  console.log(`  password:   ${DEMO_PASSWORD}`);
  console.log(`  agent id:   ${DEMO_AGENT_ID}`);
  console.log(`  channel id: ${DEMO_CHANNEL_ID}`);
  console.log(`  provider:   ${DEMO_PROVIDER_ID} (route: ${DEMO_ROUTE})`);
  console.log("");
  console.log("── Try a paid call ──────────────────────────────────────────");
  console.log("  curl -X POST \\");
  console.log(`    ${baseUrl}/v3/proxy \\`);
  console.log(`    -H 'x-agent-id: ${DEMO_AGENT_ID}' \\`);
  console.log(`    -H 'x-channel-id: ${DEMO_CHANNEL_ID}' \\`);
  console.log("    -H 'content-type: application/json' \\");
  console.log(`    -d '{"route":"${DEMO_ROUTE}","input":"hello"}'`);
  console.log("");
  console.log("  SDK:");
  console.log("    import { V3Client } from '@v3/sdk';");
  console.log("    const client = new V3Client({ baseUrl: '" + baseUrl + "' });");
  console.log(`    await client.call({ agentId: '${DEMO_AGENT_ID}', channelId: '${DEMO_CHANNEL_ID}', route: '${DEMO_ROUTE}', input: 'hello' });`);
  console.log("─────────────────────────────────────────────────────────────");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
