# Admission Architecture

## Overview

The admission path handles x402 payment verification for every paid gateway call. It resolves identity, reads scope from the registry, checks cap ceilings, and reserves meter funds. The goal is to complete admission within a strict latency budget (p99 < 50ms by default).

## Components

### 1. Admission Service (`backend/src/services/admission-service.ts`)

The core service that orchestrates the admission pipeline:

- **Identity Resolution**: Verifies x402 payment signatures and resolves the caller's identity
- **Scope Read**: Reads the registry scope and tier information
- **Cap Check**: Verifies the caller is within their cap ceiling
- **Meter Reserve**: Reserves funds from the caller's meter for the call

### 2. Admission Cache (`backend/src/services/admission-cache.ts`)

A Redis-backed cache with revocation-aware invalidation. Unlike simple TTL-based caches, this cache tracks revocation versions so entries can be immediately invalidated when caps change or scopes are revoked.

Key features:
- **Revocation-aware invalidation**: When a cap is changed or scope is revoked, the cache is invalidated immediately by incrementing a version counter
- **Dual storage**: Both Redis (distributed) and in-memory cache for resilience
- **Per-namespace TTL**: Each cache namespace (identity, scope, cap, meter) has its own TTL

### 3. Admission Middleware (`backend/src/middleware/admission.ts`)

Express middleware that runs the admission check before allowing access to x402-gated endpoints.

### 4. Configuration (`backend/src/config/admission.ts`)

Centralized configuration for the admission path, including:
- **Budget**: Total p99 budget and per-step allocations
- **Cache**: TTL and max entries per namespace
- **Parallelization**: Toggle for parallel check execution

## Latency Budget

| Step | Budget | Description |
|------|--------|-------------|
| Identity Resolution | 10ms | x402 signature verification |
| Scope Read | 10ms | Registry scope and tier lookup |
| Cap Check | 10ms | Cap ceiling verification |
| Meter Reserve | 10ms | Fund reservation |
| **Total** | **50ms** | p99 target |

### Budget Enforcement

The budget is enforced in CI via the `check-admission-budget.ts` script. If the p99 latency exceeds the total budget, CI fails, preventing new checks from silently being added to the hot path.

## Parallelization Strategy

Independent checks are executed in parallel using `Promise.all()`:

```
Phase 1 (parallel):
  ├── Identity Resolution
  └── Scope Read

Phase 2 (parallel, depends on Phase 1):
  ├── Cap Check
  └── Meter Reserve
```

This reduces the total latency from the sum of all steps to the latency of the longest phase.

## Caching Strategy

### Cache Namespaces

| Namespace | TTL | Revocation | Description |
|-----------|-----|------------|-------------|
| `identity` | 60s | Version-based | Key resolution results |
| `scope` | 30s | Version-based | Registry scope reads |
| `cap` | 60s | Version-based | Cap ceiling checks |
| `meter` | 10s | Version-based | Meter reserve results |

### Revocation-Aware Invalidation

When a cap is changed or a scope is revoked, the cache entry is immediately invalidated by incrementing the version. This ensures that stale data is never served, even within the TTL window.

### Why Not TTL Alone?

TTL-only caches can serve stale data after a cap change or scope revocation, potentially allowing unauthorized access or incorrect payment verification. The version-based revocation ensures immediate consistency.

## CI Integration

The admission budget is enforced in CI through:

1. **`.github/workflows/ci.yml`**: Runs `check-admission-budget.ts` after tests
2. **`backend/scripts/check-admission-budget.ts`**: Validates p99 latency against budget
3. **Exit code 1**: If p99 exceeds budget, CI fails

## Adding a New Admission Check

1. Add step budget allocation in `backend/src/config/admission.ts`
2. Implement the check in `AdmissionService`
3. Add cache entry if safe to cache
4. Run the CI budget gate to verify compliance
5. If budget is exceeded, optimize the check or increase the total budget

## Monitoring

The admission service provides:
- `getBudgetStatus()`: Current p99, budget compliance, and sample count
- `getLatencyRecords()`: Raw latency data for analysis
- Cache metrics via `AdmissionCacheService.getMetrics()`