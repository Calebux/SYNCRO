# ADR-010: Dual-Engine Rate Limiting (Redis + Memory Fallback) via Quota Guard

**Status:** Accepted (Retrospective)  
**Date:** 2026-06-15  
**Deciders:** Backend & Ops Engineering Teams  
**Issue/PR:** Quota Guard Implementation  

---

## Context

Protecting SYNCRO API endpoints (authentication, gift card redemption, renewal execution, webhooks) from abuse, scraping, and denial-of-service attacks requires robust rate limiting.

We evaluated two traditional approaches:
1. **Pure In-Memory Rate Limiting**: Simple and zero-dependency, but fails in multi-instance or serverless deployments because request state is not shared.
2. **Strict Centralized Redis Rate Limiting**: Highly accurate across distributed nodes, but introduces a single point of failure—if Redis is unavailable or unconfigured (such as in lightweight local dev), API endpoints fail or block legitimate requests.

---

## Decision

We designed **"Quota Guard"**, a dual-engine rate limiting architecture using a Sliding Window / Token Bucket algorithm.

- **Primary Engine**: Shared Redis instance (`REDIS_URL`) tracking window counters across all distributed API instances.
- **Fallback Engine**: Local in-memory LRU (Least Recently Used) cache activated automatically whenever Redis is unreachable, unconfigured, or timing out.
- **Configurable Tiering**: Per-route rate limits configured via environment manifests (e.g. Auth: 5 req/min, General API: 100 req/min, Webhooks: 500 req/min).

---

## Consequences

### Positive
- **High Availability & Resiliency**: API services remain operational and protected even during Redis maintenance, network degradation, or local dev without Redis.
- **Distributed Accuracy**: Distributed backend nodes share rate limit state under normal operations.
- **Zero-Friction Local Dev**: Developers can run the full stack without installing Redis locally.

### Negative
- **Graceful State Variance**: During Redis outages, multi-instance deployments temporarily fall back to per-instance memory limits, slightly increasing total allowed requests across nodes during the outage window.

---

## Compliance & Verification

- `quota_guard` package and `backend/src/middleware/rate-limiter.ts` provide unit tests for both Redis-connected and memory-fallback modes.
- Integration tests verify header output (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`).
