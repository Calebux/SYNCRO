# Metering Overage Policy and the Grace Path

This document defines how the metering layer behaves as a principal approaches,
reaches, and exceeds its configured cap. It exists so that the behaviour is
*decided* rather than emergent: a cap that rejects at exactly 100% fails an
agent mid-workflow with no warning, and a cap that allows unlimited overage is
not a cap.

## 1. Warning thresholds

Warnings fire **before** the cap binds, at configurable percentages of the
limit. Defaults:

| Threshold | Default | Meaning |
|-----------|---------|---------|
| `warn`    | 80%     | Principal is approaching the cap. |
| `critical`| 95%     | Cap will bind on the next few writes. |

Thresholds are configurable per principal (see `MeteringPolicy`). A warning is
**surfaced to the principal**, not only logged: it is returned on the write
result and emitted as a `metering.warning` event so the caller can act on it
before the cap binds. Each threshold fires at most once per period to avoid
warning spam.

## 2. Grace allowance

A configurable grace allowance **may** exist. When enabled:

- **Who authorizes it:** the principal owner (or an operator acting on their
  behalf) enables `grace.enabled` and sets `grace.allowance` in the principal's
  metering policy. It is never granted implicitly by the metering layer.
- **How much:** `grace.allowance` is an absolute amount of overage permitted
  above the cap, expressed in the same unit as the limit.
- **How it is repaid:** overage consumed from the grace allowance is recorded
  against the principal and repaid by the next period's headroom. The grace
  balance is reset at the start of each period; it does not roll over.

## 3. Bounded grace path

The grace path is **bounded and auditable**:

- It is capped at `grace.allowance` per period and cannot be extended by
  repeated requests. Once the allowance is exhausted, further writes are
  rejected until the next period or until the limit is raised.
- Every use of the grace path is recorded as an auditable `metering.grace`
  event (principal, amount, remaining allowance, timestamp).
- There is no mechanism for a caller to grant itself additional grace; only a
  policy change by the authorizing party can raise the allowance.

## 4. Actionable rejection

When a write is rejected because the cap (and any grace) is exhausted, the
rejection message states:

- **how much was available** — the remaining headroom (and remaining grace, if
  any) at the time of the request;
- **what was needed** — the amount the rejected write required;
- **how to raise it** — the concrete action, e.g. raise the principal's limit
  or enable/increase the grace allowance.

Example:

```
metering cap exceeded for principal acme: available 12, needed 40.
Raise the limit or enable a grace allowance to proceed.
```

## 5. Summary

- Warnings fire at 80% / 95% (configurable) and are surfaced to the principal.
- A grace allowance is opt-in, authorized by the principal owner, and repaid
  from the next period's headroom.
- The grace path is bounded per period and auditable; it cannot be extended
  indefinitely by repeated requests.
- Rejections are actionable: available, needed, and how to raise the limit.
