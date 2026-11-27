# Agent authority expiry (issue #1656)

`agent-registry` can now expire an agent's authority automatically, so a
forgotten agent no longer keeps its scopes forever.

## Contract API

| Function | Who | Behaviour |
| --- | --- | --- |
| `register(agent)` | admin | Registers with **no** expiry (unchanged signature). Clears any stale expiry. |
| `register_with_expiry(agent, expires_at: Option<u64>)` | admin | Registers and sets the expiry. Emits `agent/reg` and `agent/exp_set`. |
| `set_expiry(agent, expires_at: Option<u64>)` | admin | Sets, extends, shortens or clears (`None`) the expiry of a registered agent. Can revive an already-expired agent. Emits `agent/exp_set` or `agent/exp_clr`. |
| `get_expiry(agent) -> Option<u64>` | anyone | The stored expiry, `None` = never expires. |
| `is_authorized`, `has_scope` | anyone | Return `false` once expired. |
| `require_authorized`, `require_scope` | anyone | Return `Error::AuthorityExpired` (1408) once expired. |

* `expires_at` is a ledger timestamp in **seconds** (`env.ledger().timestamp()`).
* Authority is valid while `now < expires_at`; at `now == expires_at` it is already invalid.
* An expiry must be strictly in the future, otherwise `Error::InvalidExpiry` (1409).
* Events: topics `("agent", "exp_set")` with data `(agent, expires_at)`, and `("agent", "exp_clr")` with data `agent`.

## Storage layout and migration

Before #1656, each agent was one persistent entry:

```
DataKey::Agent(address) -> u32   // scope mask
```

The expiry is stored in a **separate** entry, so the existing entry is untouched:

```
DataKey::Agent(address)       -> u32   // scope mask (unchanged)
DataKey::AgentExpiry(address) -> u64   // optional expiry, key absent = never expires
```

**No storage migration is required.**

1. Upgrade the contract WASM. Every existing agent keeps working: it has no
   `AgentExpiry` entry, which means "never expires" (same behaviour as before).
2. To put an expiry on an existing agent, call `set_expiry(agent, Some(ts))` as
   admin. Nothing else needs rewriting. Scopes are preserved.
3. To roll out expiry to every existing agent, iterate the agent list held
   off-chain (the backend grant table) and call `set_expiry` for each one.
4. Rollback: calling `set_expiry(agent, None)` restores the old behaviour for an
   agent. Entries written by the new contract are still readable by the old one,
   because the `u32` mask entry never changed; the old contract simply ignores
   `AgentExpiry`, so rolling the WASM back **removes enforcement of expiry**.

Why not change the mask entry into a struct? A `u32` entry cannot be decoded as
a struct, so every existing agent would have to be rewritten before it could be
read again. Keeping the expiry in its own key avoids that.

`revoke_agent` removes both entries.

## Backend mapping

`backend/src/v3/onchain-agent-registry-reader.ts` maps the on-chain expiry
(seconds) to the grant model's `expiresAt` ISO string (`null` when no expiry),
and the existing `ScopeEnforcer` then reports `grant_expired`.
