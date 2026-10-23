Issue1:#1097 Health/readiness endpoints reflect real dependency status

health/ready must check DB, Redis, RPC/Horizon, and FX provider — not return 200 blindly (dependency-health-service.ts).

Acceptance: Readiness fails when a hard dependency is down; documented dependency matrix.

Issue2:#1064 Hardening: standardize pause coverage across all mutating entrypoints

subscription_renewal checks is_paused on some entrypoints but not all mutating fns; audit every contract for consistent pause gating.

Acceptance: Matrix of entrypoint × pause-gated; missing gates added; tests.


