# Contract Upgrade Governance Threat Model

This contract is designed to make upgrade execution intentionally slower and
more observable than a direct admin action.

## Invariants

- The guardian set must contain 2 or 3 distinct addresses.
- An upgrade requires 2 approvals before it can become executable.
- The execution timelock cannot be shortened below 3600 seconds.
- The rollback slot is single-use and is consumed on the first rollback.

## Threats Addressed

- **Fast-path admin override**: prevented by the minimum timelock.
- **Duplicate guardian configuration**: prevented by explicit uniqueness
  checks during init and guardian replacement.
- **Approval replay**: prevented by tracking approvals per guardian.
- **Rollback replay**: prevented by a persistent consumed flag that blocks any
  second rollback until a new upgrade execution creates a fresh slot.

## Operational Notes

- The admin may still recover the contract if the slot is available, but the
  same rollback hash cannot be replayed.
- A new executed upgrade resets the rollback slot to allow exactly one
  rollback for that execution path.
