# SYNCRO Initiative Specs

Three major architectural initiatives to improve quality, visibility, and security.

## Initiatives

### 1. [Ephemeral Preview Environments for PRs](./01-preview-environments.md)

**Goal**: Enable reviewers to test complete end-to-end flows with real data in a running system.

**Problem**: Integration-shaped regressions only appear in running systems. Screenshots and diffs miss critical issues.

**Solution**: Deploy client + backend + seeded database per PR, post preview URL on PR, tear down on close/merge.

**Key Acceptance Criteria**:
- Every PR gets a preview URL
- Environments are seeded and usable without manual setup
- Environments are destroyed on close/merge with cost controls
- Testnet contracts enforced by configuration

**Status**: Spec ready for requirements refinement

---

### 2. [System Architecture Diagrams](./02-system-architecture-diagrams.md)

**Goal**: Make system architecture visible, reviewable, and documentable.

**Problem**: Architecture only exists in prose. No diagram shows how Next.js client, Express backend, Supabase, Redis, job runners, 8 Soroban contracts, payment providers, and email providers fit together.

**Solution**: C4 levels 1-3 + sequence diagrams for critical flows, all in Mermaid for diffs in review.

**Key Acceptance Criteria**:
- C4 L1-L3 diagrams exist and are current
- 5 sequence diagrams for: subscription creation, reminder delivery, renewal, webhooks, gift-card redemption
- Diagrams are Mermaid source (not images), rendered in docs and verified in CI

**Status**: Spec ready for requirements refinement

---

### 3. [Cryptographic Specification and Cross-Implementation Testing](./03-cryptographic-specification.md)

**Goal**: Prevent silent cryptographic failures through explicit specification and deterministic testing.

**Problem**: `commitment::compute_commitment` and `nullifier::compute_nullifier` defined only in Rust with no domain separation. Derivations differing by one byte fail silently as 'invalid proof'. No cross-implementation tests.

**Solution**: Written specification + distinct domain tags + deterministic test vectors validated in Rust, TypeScript SDK, and TypeScript shared.

**Key Acceptance Criteria**:
- Written spec with encoding, ordering, domain separation
- Different domain tags for commitment and nullifier
- Same test vectors passing in Rust, SDK, and shared
- Changing derivation fails tests in all places

**Status**: Spec ready for requirements refinement

---

## Getting Started

Each spec contains:
- **Problem Statement**: Why this matters
- **Scope**: What we're building
- **Acceptance Criteria**: How to know when it's done
- **Key Files/Areas**: Where the code lives
- **Requirements**: Detailed functional requirements
- **Design Decisions**: Why we chose this approach
- **Implementation Tasks**: Step-by-step work breakdown
- **Open Questions**: Things to clarify in design phase

## Next Steps

1. Review each spec with the team
2. Clarify open questions in each spec
3. Sequence the initiatives (parallel or serial?)
4. Begin detailed design for first initiative
5. Create implementation tasks and assign

## Status Dashboard

| Initiative | Spec | Design | Implementation | Review |
|-----------|------|--------|-----------------|--------|
| Preview Envs | ✅ Done | ⏳ Ready | ⏹️ Not started | ⏹️ |
| Architecture Diagrams | ✅ Done | ⏳ Ready | ⏹️ Not started | ⏹️ |
| Crypto Spec | ✅ Done | ⏳ Ready | ⏹️ Not started | ⏹️ |

