# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Fault Condition** - Panics on unregistered/missing-scope inputs
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing cases for reproducibility
  - In `contracts/contracts/agent-registry/src/test.rs`, write three deterministic test cases:
    1. Call `client.try_require_authorized(&unregistered_agent)` — assert `Err(Ok(Error::NotRegistered))` (isBugCondition_Authorized holds: no storage entry)
    2. Register an agent with `Scope::Renewals`, call `client.try_require_scope(&agent, &Scope::GiftCards)` — assert `Err(Ok(Error::MissingScope))` (isBugCondition_Scope holds: bit not set)
    3. Call `client.try_require_scope(&unregistered_agent, &Scope::Renewals)` — assert `Err(Ok(Error::MissingScope))` (isBugCondition_Scope holds: stored_mask is None)
  - Run tests on UNFIXED code: `cargo test -p agent-registry -- test_fault_condition`
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bug exists; unfixed code panics instead of returning typed errors)
  - Document counterexamples found (e.g., `try_require_authorized` returns a host panic error, not `Err(Ok(Error::NotRegistered))`)
  - Mark task complete when tests are written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Ok paths and bool-returning helpers unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code:
    - `try_require_authorized` on a registered agent returns `Ok(Ok(()))`
    - `try_require_scope` on an agent whose mask includes the requested scope returns `Ok(Ok(()))`
    - `is_authorized` returns the correct `bool` for registered/unregistered agents
    - `has_scope` returns the correct `bool` for present/absent scope bits
  - Write property-based tests in `test.rs`:
    - For all registered agents (any valid address, any non-zero mask): `try_require_authorized` returns `Ok(Ok(()))` — covers NOT isBugCondition_Authorized
    - For all (agent, scope) where mask includes scope bit: `try_require_scope` returns `Ok(Ok(()))` — covers NOT isBugCondition_Scope
    - For all agents: `is_authorized` returns `true` iff agent is registered (3.3)
    - For all (agent, scope, mask): `has_scope` returns `true` iff `(mask & scope as u32) != 0` (3.4)
  - Run tests on UNFIXED code: `cargo test -p agent-registry -- test_preservation`
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Fix require_authorized and require_scope to return typed errors

  - [x] 3.1 Add NotRegistered and MissingScope variants to the Error enum
    - In `contracts/contracts/agent-registry/src/lib.rs`, locate the `Error` enum
    - Append `NotRegistered = 7` and `MissingScope = 8` as the next available discriminants
    - _Bug_Condition: isBugCondition_Authorized holds when `!env.storage().persistent().has(&DataKey::Agent(agent))`; isBugCondition_Scope holds when stored_mask is None or `(stored_mask & scope as u32) == 0`_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Convert require_authorized to return Result<(), Error>
    - Change signature from `pub fn require_authorized(env: Env, agent: Address)` to `pub fn require_authorized(env: Env, agent: Address) -> Result<(), Error>`
    - Replace `panic!("agent not authorized")` with `return Err(Error::NotRegistered)`
    - Inline the storage check (`env.storage().persistent().has(&DataKey::Agent(agent))`) to avoid an unnecessary `env` clone; drop the delegation to `is_authorized`
    - Add `Ok(())` as the final return
    - _Expected_Behavior: `Err(Error::NotRegistered)` when isBugCondition_Authorized holds; `Ok(())` otherwise_
    - _Requirements: 2.1, 2.3, 2.4_

  - [x] 3.3 Convert require_scope to return Result<(), Error>
    - Change signature from `pub fn require_scope(env: Env, agent: Address, scope: Scope)` to `pub fn require_scope(env: Env, agent: Address, scope: Scope) -> Result<(), Error>`
    - Keep `agent.require_auth()` as the first statement
    - Clone `agent` before passing it to `has_scope` to satisfy the borrow checker: `Self::has_scope(env, agent.clone(), scope)`
    - Replace `panic!("agent missing required scope")` with `return Err(Error::MissingScope)`
    - Add `Ok(())` as the final return
    - _Expected_Behavior: `Err(Error::MissingScope)` when isBugCondition_Scope holds; `Ok(())` otherwise_
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 3.4 Update all callers of require_authorized and require_scope within agent-registry/src/lib.rs
    - Search for all call sites of `require_authorized` and `require_scope` in `lib.rs`
    - Propagate the `Result` at each call site using the `?` operator
    - Verify the enclosing function already returns `Result<_, Error>`; update its signature if not
    - _Preservation: Preservation Requirements — non-buggy call paths continue returning Ok(())_
    - _Requirements: 2.4, 3.1, 3.2, 3.5_

  - [x] 3.5 Check and update any callers in subscription_renewal
    - Search the `subscription_renewal` crate for calls to `require_authorized` or `require_scope`
    - If any exist, update them to propagate the `Result` with `?`
    - Per the design, no such cross-contract callers are expected — document the finding either way
    - _Requirements: 3.5_

  - [x] 3.6 Replace #[should_panic] tests in test.rs with typed error assertions
    - Remove or replace `test_require_authorized_panics` with `test_require_authorized_not_registered`:
      - Set up env, register contract, call `init`, generate unregistered agent
      - Assert `client.try_require_authorized(&agent)` returns `Err(Ok(Error::NotRegistered))`
    - Remove or replace `test_require_scope_panics_without_scope` with `test_require_scope_missing_scope`:
      - Set up env, register contract, call `init`, register agent with `Scope::Renewals`
      - Assert `client.try_require_scope(&agent, &Scope::GiftCards)` returns `Err(Ok(Error::MissingScope))`
    - _Requirements: 2.1, 2.2_

  - [x] 3.7 Verify no panic!, unwrap(), or expect() remains in agent-registry/src/lib.rs
    - Search `contracts/contracts/agent-registry/src/lib.rs` for `panic!`, `unwrap()`, and `expect(`
    - Resolve any remaining instances by converting to typed errors or removing
    - _Requirements: 2.3_

  - [x] 3.8 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Panics replaced by NotRegistered / MissingScope
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - Run: `cargo test -p agent-registry -- test_fault_condition`
    - **EXPECTED OUTCOME**: Tests PASS (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.9 Verify preservation tests still pass
    - **Property 2: Preservation** - Ok paths and bool helpers unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run: `cargo test -p agent-registry -- test_preservation`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full agent-registry test suite: `cargo test -p agent-registry`
  - Confirm `test_register_then_grant_and_check_scopes` and all admin/revocation tests pass without modification
  - Ensure all tests pass; ask the user if questions arise
