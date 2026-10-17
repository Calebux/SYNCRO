# Scoped spend caps (issue #1658)

A spend cap can now be limited to one provider or route, so a principal can say
"at most 5 USDC per day on inference and 1 USDC on storage".

## API

| Function | Behaviour |
| --- | --- |
| `issue_cap(principal, agent, allowance, period_secs)` | Unchanged. Issues an **unscoped** cap. |
| `issue_scoped_cap(principal, agent, allowance, period_secs, scope: Option<Symbol>)` | Issues a cap limited to `scope`. `None` = unscoped (same as `issue_cap`). |
| `can_transact(cap_id, amount)` | Unchanged. Debits exactly the named cap. |
| `can_transact_scoped(principal, agent, scope: Option<Symbol>, amount)` | Debits **every matching cap** of the pair (see below). Returns the smallest headroom left. |
| `get_cap_scope(cap_id) -> Option<Symbol>` | The cap's scope, `None` if unscoped. |
| `get_pair_caps(principal, agent) -> Vec<u64>` | Ids of the caps issued by the principal to the agent. |

`scope` is an opaque key of at most 32 chars (`[A-Za-z0-9_]`): a route scope
such as `inference`, or whatever id the gateway maps a provider to.

## Which caps match a `can_transact_scoped` request

| Cap | Request `Some(k)` | Request `None` |
| --- | --- | --- |
| scoped to `k` | matches | no |
| scoped to another key | no | no |
| unscoped | matches (overall ceiling) | matches |

* Every matching cap must have headroom. If one does not, nothing is debited
  and the call fails with `CapExceeded` (or `CapSuspended`).
* No matching cap at all fails with `NoMatchingCap`.
* An agent that exhausted its `inference` cap can still spend under its
  `storage` cap, unless an unscoped ceiling is also exhausted.
* Periods roll over per cap, so each cap can have its own period.

Example: `issue_scoped_cap(.., 5, day, Some(inference))` and
`issue_scoped_cap(.., 1, day, Some(storage))`. Spending 5 on inference leaves
the storage cap untouched; spending 1 on storage still succeeds.

## Limits

A principal can issue at most `MAX_CAPS_PER_PAIR` (32) caps to one agent
(`TooManyCaps`). This bounds the work done per `can_transact_scoped` call.

## Storage layout and migration

```
DataKey::Cap(id)              -> SpendCap   (struct unchanged)
DataKey::CapScope(id)         -> Symbol     (new; absent = unscoped)
DataKey::PairCaps(prin, agent) -> Vec<u64>  (new; caps issued after the upgrade)
```

The scope lives in its own entry because adding a field to `SpendCap` would make
every stored cap undecodable.

**No storage migration is required.**

1. Upgrade the WASM. Caps issued before the upgrade have no `CapScope` entry, so
   they are unscoped and keep working through `can_transact(cap_id, ..)`,
   `get_cap` and `get_balance` exactly as before.
2. Those older caps are **not** in the `PairCaps` index, so
   `can_transact_scoped` does not see them. To bring a limit under the scoped
   flow, have the principal issue a new cap with `issue_cap` /
   `issue_scoped_cap` and stop using the old id.
3. Rolling the WASM back leaves old data valid; the extra entries are ignored.
