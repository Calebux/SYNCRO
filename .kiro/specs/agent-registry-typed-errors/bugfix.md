# Bugfix Requirements Document

## Introduction

`require_authorized` and `require_scope` in `contracts/contracts/agent-registry/src/lib.rs` call `panic!()` when an agent fails an authorization or scope check. The rest of the contract uses `Result<_, Error>` consistently. Panics in Soroban produce an opaque host error, consume the caller's full fee, and are indistinguishable from genuine contract faults by the SDK — the same class of problem already fixed in `subscription_renewal`. This fix replaces both panics with typed `Result` errors and extends the `Error` enum with two new variants.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `require_authorized` is called with an agent address that has no registered entry THEN the system panics with the string `"agent not authorized"`

1.2 WHEN `require_scope` is called with an agent that lacks the requested scope THEN the system panics with the string `"agent missing required scope"`

1.3 WHEN either panic is triggered THEN the system returns an opaque host error to the caller that cannot be distinguished from an unrelated contract fault

1.4 WHEN either panic is triggered THEN the system charges the caller the full transaction fee with no structured error information

### Expected Behavior (Correct)

2.1 WHEN `require_authorized` is called with an agent address that has no registered entry THEN the system SHALL return `Err(Error::NotRegistered)` without panicking

2.2 WHEN `require_scope` is called with an agent that lacks the requested scope THEN the system SHALL return `Err(Error::MissingScope)` without panicking

2.3 WHEN an authorization or scope failure occurs THEN the system SHALL return a typed error value that the SDK can decode to a readable name

2.4 WHEN `require_authorized` or `require_scope` succeeds THEN the system SHALL return `Ok(())`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `require_authorized` is called with a registered agent address THEN the system SHALL CONTINUE TO return `Ok(())` without error

3.2 WHEN `require_scope` is called with an agent that possesses the requested scope THEN the system SHALL CONTINUE TO return `Ok(())` without error

3.3 WHEN `is_authorized` is called with any agent address THEN the system SHALL CONTINUE TO return a `bool` reflecting registration state

3.4 WHEN `has_scope` is called with any agent and scope THEN the system SHALL CONTINUE TO return a `bool` reflecting scope state

3.5 WHEN all other `Result`-returning contract functions (`init`, `register`, `revoke_agent`, `update_scopes`, `transfer_admin`, `cancel_transfer_admin`, `accept_admin`) are called under valid conditions THEN the system SHALL CONTINUE TO behave as before

---

## Bug Condition

```pascal
FUNCTION isBugCondition_Authorized(agent: Address, env: Env)
  INPUT: agent of type Address, env of type Env
  OUTPUT: boolean

  RETURN NOT env.storage().persistent().has(DataKey::Agent(agent))
END FUNCTION

FUNCTION isBugCondition_Scope(agent: Address, scope: Scope, env: Env)
  INPUT: agent of type Address, scope of type Scope, env of type Env
  OUTPUT: boolean

  stored_mask ← env.storage().persistent().get(DataKey::Agent(agent))
  RETURN stored_mask IS NONE OR (stored_mask AND scope as u32) = 0
END FUNCTION
```

```pascal
// Property: Fix Checking — require_authorized
FOR ALL (agent) WHERE isBugCondition_Authorized(agent, env) DO
  result ← require_authorized'(env, agent)
  ASSERT result = Err(Error::NotRegistered)
END FOR

// Property: Fix Checking — require_scope
FOR ALL (agent, scope) WHERE isBugCondition_Scope(agent, scope, env) DO
  result ← require_scope'(env, agent, scope)
  ASSERT result = Err(Error::MissingScope)
END FOR

// Property: Preservation Checking
FOR ALL (agent) WHERE NOT isBugCondition_Authorized(agent, env) DO
  ASSERT require_authorized'(env, agent) = require_authorized(env, agent)
END FOR

FOR ALL (agent, scope) WHERE NOT isBugCondition_Scope(agent, scope, env) DO
  ASSERT require_scope'(env, agent, scope) = require_scope(env, agent, scope)
END FOR
```
