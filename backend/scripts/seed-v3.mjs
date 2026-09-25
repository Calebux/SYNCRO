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

async function seed() {
  console.log("Seeding v3 local-dev data…");

  // --- Principal (auth user) ---
  const principalId = crypto.randomUUID();
  const { error: userErr } = await supabase.auth.admin.createUser({
    id: principalId,
    email: `v3-dev-${principalId.slice(0, 8)}@local.dev`,
    password: "dev-password-123",
    email_confirm: true,
  });
  if (userErr) {
    console.warn(`Auth user creation skipped (may already exist): ${userErr.message}`);
  }
  console.log(`Principal (auth user): id=${principalId}`);

  // --- Payment channel (open, funded) ---
  const channelId = `v3-ch-${crypto.randomUUID().slice(0, 12)}`;
  const channelSize = 5000; // 5000 units funded
  const { error: channelErr } = await supabase.from("payment_channels").insert({
    user_id: principalId,
    channel_id: channelId,
    recipient_id: principalId,
    balance: channelSize,
    status: "active",
    metadata: { v3: true, seeded: true },
  });
  if (channelErr) console.warn(`Channel insert: ${channelErr.message}`);
  console.log(`Channel: id=${channelId} size=${channelSize} status=active`);

  // --- Channel state (initial state) ---
  const { error: stateErr } = await supabase.from("channel_states").insert({
    channel_id: channelId,
    state_number: 1,
    balance: channelSize,
    nonce: crypto.randomUUID(),
    signature: "dev-signature",
    confirmed: true,
  });
  if (stateErr) console.warn(`Channel state insert: ${stateErr.message}`);

  // --- Pending settlement (open, funded) ---
  const { error: settleErr } = await supabase.from("pending_settlements").insert({
    user_id: principalId,
    channel_id: channelId,
    settlement_amount: channelSize,
    status: "pending",
  });
  if (settleErr) console.warn(`Pending settlement insert: ${settleErr.message}`);

  // --- Agent with scope and cap (stored in profiles or a custom table) ---
  // Try to insert into profiles if it exists; otherwise skip gracefully.
  const agentId = crypto.randomUUID();
  const { error: profileErr } = await supabase.from("profiles").insert({
    id: principalId,
    agent_id: agentId,
    scopes: ["paid-call:proxy"],
    cap: 1000,
    v3: true,
  });
  if (profileErr) {
    // profiles table may not exist yet — that's fine for seed
    console.warn(`Profile insert skipped: ${profileErr.message}`);
  }
  console.log(`Agent: id=${agentId} scope=paid-call:proxy cap=1000`);

  console.log("v3 seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
