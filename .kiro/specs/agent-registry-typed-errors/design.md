# Agent Registry Typed Errors Bugfix Design

## Overview

`require_authorized` and `require_scope` in `contracts/contracts/agent-registry/src/lib.rs`
currently call `panic!()` when an authorization or scope check fails. Soroban panics produce
an opaque host error that is indistinguishable from unrelated contract faults, consume the
caller's full fee, and cannot be decoded by the SDK. The rest of the contract already returns
`Result<_, Error>` consistently.

The fix adds two new variants to the `Error` enum (`NotRegistered`, `MissingScope`), converts
both functions to return `Result<(), Error>`, and replaces the two `#[should_panic]` tests in
`test.rs` with assertions on the specific error variants via `try_*` client methods.

No cross-contract callers of `require_authorized` or `require_scope` exist outside
`agent-registry` itself, so no other crates require changes.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when `require_authorized` or
  `require_scope` is called with an input that fails the check, causing an uncontrolled panic
  instead of a typed `Result` error.
- **Property (P)**: The desired behavior when a check fails — the function SHALL return
  `Err(Error::NotRegistered)` or `Err(Error::MissingScope)` respectively, without panicking.
- **Preservation**: Existing behavior for passing inputs (`Ok(())` return paths, `is_authorized`,
  `has_scope`, and all other contract functions) that must remain unchanged by the fix.
- **`require_authorized`**: The function in `lib.rs` (line ~195) that checks whether an agent
  address has a registered entry in persistent storage.
- **`require_scope`**: The function in `lib.rs` (line ~206) that calls `agent.require_auth()`
  then checks whether the agent's stored scope mask includes the requested `Scope` bit.
- **`isBugCondition_Authorized`**: Pseudocode predicate — true when persistent storage has no
  entry for the given agent address.
- **`isBugCondition_Scope`**: Pseudocode predicate — true when the stored scope mask is absent
  or does not include the requested scope bit.
- **scope mask**: A `u32` stored under `DataKey::Agent(address)` where each bit corresponds to
  a `Scope` variant value.

## Bug Details

### Fault Condition

The bug manifests when `require_authorized` is called for an address with no registry entry,
or when `require_scope` is called for an agent whose stored mask does not include the requested
scope. Both functions reach a `panic!()` call instead of propagating a typed error.

**Formal Specification:**

```
FUNCTION isBugCondition_Authorized(agent, env)
  INPUT: agent of type Address, env of type Env
  OUTPUT: boolean

  RETURN NOT env.storage().persistent().has(DataKey::Agent(agent))
END FUNCTION

FUNCTION isBugCondition_Scope(agent, scope, env)
  INPUT: agent of type Address, scope of type Scope, env of type Env
  OUTPUT: boolean

  stored_mask ← env.storage().persistent().get::<_, u32>(DataKey::Agent(agent))
  RETURN stored_mask IS NONE
         OR (stored_mask AND scope as u32) = 0
END FUNCTION
```

### Examples

- `require_authorized(env, unregistered_addr)` — panics with `"agent not authorized"`;
  expected: `Err(Error::NotRegistered)`
- `require_authorized(env, registered_addr)` — returns `()`; expected: `Ok(())` (unchanged)
- `require_scope(env, registered_agent, Scope::GiftCards)` where agent has only
  `Scope::Renewals` in its mask — panics with `"agent missing required scope"`;
  expected: `Err(Error::MissingScope)`
- `require_scope(env, registered_agent, Scope::Renewals)` where agent has
  `Scope::Renewals` in its mask — returns `()`; expected: `Ok(())` (unchanged)
- `require_scope(env, unregistered_agent, Scope::Renewals)` — `has_scope` returns `false`
  (None branch), so panics; expected: `Err(Error::MissingScope)`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `require_authorized` called with a registered agent address MUST continue to return `Ok(())`
- `require_scope` called with an agent that possesses the requested scope MUST continue to
  return `Ok(())`
- `is_authorized` MUST continue to return a `bool` reflecting registration state — its
  signature is not touched by this fix
- `has_scope` MUST continue to return a `bool` reflecting scope state — its signature is not
  touched by this fix
- All other `Result`-returning functions (`init`, `register`, `revoke_agent`, `update_scopes`,
  `transfer_admin`, `cancel_transfer_admin`, `accept_admin`) MUST continue to behave as before

**Scope:**
All inputs that do NOT satisfy `isBugCondition_Authorized` or `isBugCondition_Scope` are
completely unaffected by this fix. This includes:
- Calls to `require_authorized` with a registered agent
- Calls to `require_scope` with an agent whose mask includes the requested scope
- All calls to `is_authorized`, `has_scope`, and the admin-gated functions

## Hypothesized Root Cause

The functions were written before the contract adopted the `Result<_, Error>` convention.
Their signatures return `()` (unit) rather than `Result<(), Error>`, so there is no mechanism
to propagate a typed error — `panic!()` was used as a shortcut.

1. **Missing Error variants**: `Error` has no `NotRegistered` or `MissingScope` variant, so
   even if the return type were changed today the compiler would reject the `Err(...)` arms.

2. **Wrong return type on both functions**: Both functions declare `-> ()` (implicit unit).
   They must be changed to `-> Result<(), Error>` before any error can be returned.

3. **`require_scope` call site inside itself**: After `agent.require_auth()`, the function
   delegates to `Self::has_scope(env, agent, scope)` (which borrows `env` and `agent`).
   The borrow of `agent` for `require_auth()` and the subsequent move into `has_scope` will
   need to be reconciled — likely by cloning `agent` or restructuring the inline check.

4. **Test expectations must change**: Two tests use `#[should_panic]`; they must be rewritten
   to call the `try_*` client variants and assert on the error discriminant.

## Correctness Properties

Property 1: Fault Condition - require_authorized returns NotRegistered

_For any_ agent address where `isBugCondition_Authorized` holds (the address has no persistent
storage entry), the fixed `require_authorized` function SHALL return `Err(Error::NotRegistered)`
without panicking.

**Validates: Requirements 2.1, 2.3**

Property 2: Fault Condition - require_scope returns MissingScope

_For any_ (agent, scope) pair where `isBugCondition_Scope` holds (stored mask absent or bit
not set), the fixed `require_scope` function SHALL return `Err(Error::MissingScope)` without
panicking.

**Validates: Requirements 2.2, 2.3**

Property 3: Preservation - require_authorized Ok path unchanged

_For any_ agent address where `isBugCondition_Authorized` does NOT hold (the address has a
persistent storage entry), the fixed `require_authorized` SHALL return `Ok(())`, identical to
the behavior of the original function on that input.

**Validates: Requirements 2.4, 3.1**

Property 4: Preservation - require_scope Ok path unchanged

_For any_ (agent, scope) pair where `isBugCondition_Scope` does NOT hold (stored mask present
and bit is set), the fixed `require_scope` SHALL return `Ok(())`, identical to the behavior of
the original function on that input.

**Validates: Requirements 2.4, 3.2**

## Fix Implementation

### Changes Required

**File**: `contracts/contracts/agent-registry/src/lib.rs`

**Change 1 — Add Error variants**

Add two new discriminants to the `Error` enum. Values 7 and 8 are the next available integers
after the existing six variants:

```rust
NotRegistered = 7,
MissingScope  = 8,
```

**Change 2 — Update `require_authorized` signature and body**

Before:
```rust
pub fn require_authorized(env: Env, agent: Address) {
    if !Self::is_authorized(env, agent) {
        panic!("agent not authorized");
    }
}
```

After:
```rust
pub fn require_authorized(env: Env, agent: Address) -> Result<(), Error> {
    if !Self::is_authorized(env.clone(), agent) {
        return Err(Error::NotRegistered);
    }
    Ok(())
}
```

Note: `is_authorized` consumes `env`, so either clone `env` before the call or inline the
storage check directly. Inlining avoids an extra clone:

```rust
pub fn require_authorized(env: Env, agent: Address) -> Result<(), Error> {
    if !env.storage().persistent().has(&DataKey::Agent(agent)) {
        return Err(Error::NotRegistered);
    }
    Ok(())
}
```

**Change 3 — Update `require_scope` signature and body**

Before:
```rust
pub fn require_scope(env: Env, agent: Address, scope: Scope) {
    agent.require_auth();
    if !Self::has_scope(env, agent, scope) {
        panic!("agent missing required scope");
    }
}
```

After (clone `agent` to satisfy borrow checker — `require_auth` takes `&self`, but
`has_scope` moves `agent`):
```rust
pub fn require_scope(env: Env, agent: Address, scope: Scope) -> Result<(), Error> {
    agent.require_auth();
    if !Self::has_scope(env, agent.clone(), scope) {
        return Err(Error::MissingScope);
    }
    Ok(())
}
```

**File**: `contracts/contracts/agent-registry/src/test.rs`

**Change 4 — Replace `#[should_panic]` tests with typed error assertions**

Replace `test_require_authorized_panics`:
```rust
#[test]
fn test_require_authorized_not_registered() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    client.init(&admin);

    let result = client.try_require_authorized(&agent);
    assert_eq!(result, Err(Ok(Error::NotRegistered)));
}
```

Replace `test_require_scope_panics_without_scope`:
```rust
#[test]
fn test_require_scope_missing_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AgentRegistry);
    let client = AgentRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let agent = Address::generate(&env);
    client.init(&admin);
    client.register(&agent);
    client.update_scopes(&agent, &(Scope::Renewals as u32));

    let result = client.try_require_scope(&agent, &Scope::GiftCards);
    assert_eq!(result, Err(Ok(Error::MissingScope)));
}
```

## Testing Strategy

### Validation Approach

Testing follows two phases: first, surface counterexamples on the unfixed code to confirm the
root cause; then verify the fix satisfies all correctness properties and preserves unchanged
behavior.

### Exploratory Fault Condition Checking

**Goal**: Run tests against the UNFIXED code to observe panics and confirm the root cause.
If the tests do not fail as expected, the hypothesis must be revised before implementing.

**Test Plan**: Write tests that call `try_require_authorized` and `try_require_scope` on
inputs satisfying the bug condition and assert on the typed error variant. On unfixed code
these calls will produce a host/panic error rather than `Err(Ok(Error::NotRegistered))`.

**Test Cases**:
1. **Unregistered agent authorization** (will fail on unfixed code): call
   `try_require_authorized` with an address that was never registered; expect
   `Err(Ok(Error::NotRegistered))` — unfixed code panics instead.
2. **Missing scope** (will fail on unfixed code): register an agent with `Scope::Renewals`,
   then call `try_require_scope` demanding `Scope::GiftCards`; expect
   `Err(Ok(Error::MissingScope))` — unfixed code panics instead.
3. **Unregistered agent scope check** (will fail on unfixed code): call `try_require_scope`
   with a completely unregistered agent; expect `Err(Ok(Error::MissingScope))` — unfixed code
   panics instead.
4. **Out-of-band scope bit** (edge case, may fail on unfixed code): call `try_require_scope`
   with a scope bit not present in the mask after `update_scopes(&agent, &0u32)`.

**Expected Counterexamples**:
- `try_require_authorized` returns a host panic error, not `Err(Ok(Error::NotRegistered))`
- `try_require_scope` returns a host panic error, not `Err(Ok(Error::MissingScope))`
- Possible causes: missing enum variants, wrong return type (`()` instead of `Result<(), Error>`)

### Fix Checking

**Goal**: After implementing the fix, verify that all inputs satisfying the bug condition now
return the correct typed error.

**Pseudocode:**
```
FOR ALL agent WHERE isBugCondition_Authorized(agent, env) DO
  result ← require_authorized_fixed(env, agent)
  ASSERT result = Err(Error::NotRegistered)
END FOR

FOR ALL (agent, scope) WHERE isBugCondition_Scope(agent, scope, env) DO
  result ← require_scope_fixed(env, agent, scope)
  ASSERT result = Err(Error::MissingScope)
END FOR
```

### Preservation Checking

**Goal**: Verify that inputs not satisfying the bug condition produce identical results before
and after the fix.

**Pseudocode:**
```
FOR ALL agent WHERE NOT isBugCondition_Authorized(agent, env) DO
  ASSERT require_authorized_fixed(env, agent) = Ok(())
END FOR

FOR ALL (agent, scope) WHERE NOT isBugCondition_Scope(agent, scope, env) DO
  ASSERT require_scope_fixed(env, agent, scope) = Ok(())
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many (agent, scope, mask) combinations automatically
- It catches bit-mask edge cases that manual tests might miss (e.g., multiple scopes set,
  all bits set, single bit set matching exactly)
- It provides strong guarantees that `Ok(())` is returned for all valid inputs

**Test Plan**: Observe existing passing tests on unfixed code to record correct behavior, then
write property-based tests that verify preservation after the fix.

**Test Cases**:
1. **Registered agent Ok path**: `try_require_authorized` on a registered agent returns
   `Ok(Ok(()))` before and after the fix.
2. **Scope present Ok path**: `try_require_scope` on an agent whose mask includes the
   requested scope returns `Ok(Ok(()))` before and after the fix.
3. **`is_authorized` unchanged**: `is_authorized` returns the same bool before and after
   the fix for any registration state.
4. **`has_scope` unchanged**: `has_scope` returns the same bool before and after the fix
   for any (agent, scope, mask) combination.

### Unit Tests

- `test_require_authorized_not_registered`: unregistered agent → `Err(Ok(Error::NotRegistered))`
- `test_require_authorized_registered_ok`: registered agent → `Ok(Ok(()))`
- `test_require_scope_missing_scope`: agent with wrong scope mask → `Err(Ok(Error::MissingScope))`
- `test_require_scope_unregistered_agent`: unregistered agent → `Err(Ok(Error::MissingScope))`
- `test_require_scope_succeeds_with_scope`: agent with correct scope → `Ok(Ok(()))` (existing
  test, must continue to pass unchanged)

### Property-Based Tests

- Generate random sets of (registered agents, scope masks) and verify `require_authorized`
  returns `Ok(())` for all registered agents and `Err(Error::NotRegistered)` for all others.
- Generate random (agent, scope, mask) triples and verify `require_scope` returns `Ok(())`
  iff `(mask & scope as u32) != 0`, and `Err(Error::MissingScope)` otherwise.
- Generate random inputs to `is_authorized` and `has_scope` and verify their bool return
  values are unaffected by the presence of the new enum variants (smoke preservation test).

### Integration Tests

- Full flow: `init` → `register` → `update_scopes` → `require_scope` succeeds → revoke →
  `require_authorized` returns `Err(Error::NotRegistered)`.
- Confirm that the existing `test_register_then_grant_and_check_scopes` test continues to
  pass without modification after the fix.
- Confirm that all admin-transfer and revocation tests pass without modification.
