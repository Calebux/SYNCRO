# SYNCRO Architectural Initiatives - Summary

**Branch**: `feature/preview-envs-and-architecture`

**Date Created**: August 26, 2026

**Status**: Specs Complete ✅

---

## Overview

Three comprehensive specifications have been created to address critical gaps in review processes, system visibility, and cryptographic correctness:

### 1. Ephemeral Preview Environments for PRs
**File**: `.kiro/specs/01-preview-environments.md`

Integration-shaped regressions are invisible in diff-only reviews. This initiative enables reviewers to test complete end-to-end flows by:
- Deploying Next.js client + Express backend per PR
- Seeding with consistent test data
- Posting preview URLs and credentials on PRs
- Tearing down environments on close/merge with cost caps

**Impact**: Catches integration bugs before they reach production.

---

### 2. System Architecture Diagrams
**File**: `.kiro/specs/02-system-architecture-diagrams.md`

The system is complex (Next.js client, Express backend, Supabase, Redis, job runners, 8 Soroban contracts, 2+ payment providers, 2+ email providers) but undocumented visually. This initiative creates:
- C4 Level 1-3 diagrams (system context → containers → components)
- Sequence diagrams for 5 critical flows
- All in Mermaid format (diffs in review)
- Rendered to docs site and verified in CI

**Impact**: Makes architecture reviewable, supports threat modeling, eases onboarding.

---

### 3. Cryptographic Specification with Cross-Implementation Testing
**File**: `.kiro/specs/03-cryptographic-specification.md`

Commitment and nullifier derivations differ between Rust (contracts) and TypeScript (SDK/shared) with no specification. Silent failures and replay risks. This initiative:
- Writes explicit specification for both derivations
- Adds distinct domain separation tags
- Creates deterministic test vectors
- Validates same vectors pass in Rust, SDK, and shared crypto
- Pins test vectors so any change is a visible breaking change

**Impact**: Prevents cryptographic bugs, makes derivation changes explicit and reviewable.

---

## Specs Location

All specs are in `.kiro/specs/`:
```
.kiro/specs/
├── README.md                              (overview & status dashboard)
├── 01-preview-environments.md             (preview env orchestration)
├── 02-system-architecture-diagrams.md     (C4 + sequence diagrams)
└── 03-cryptographic-specification.md      (crypto spec + test vectors)
```

Each spec contains:
- Problem statement
- Scope and acceptance criteria
- Detailed requirements (R1-R7)
- Design decisions
- Implementation tasks
- Open questions
- Success metrics

---

## Next Steps

### Immediate
1. Review specs with stakeholders
2. Clarify open questions in each spec
3. Decide execution order (parallel vs. serial)

### Per Initiative

**Preview Environments**:
- [ ] Select cloud platforms (Vercel, Railway, Supabase)
- [ ] Design seed dataset and migration strategy
- [ ] Create GitHub Actions workflow scaffolding
- [ ] Set up environment variable and secret management

**Architecture Diagrams**:
- [ ] Extract current system architecture from code
- [ ] Create Mermaid diagram templates
- [ ] Identify the 5 critical flows for sequence diagrams
- [ ] Set up Mermaid rendering in docs build

**Crypto Specification**:
- [ ] Review current Rust commitment/nullifier implementations
- [ ] Define field encoding and domain separation approach
- [ ] Generate test vectors from current implementation
- [ ] Create spec document for review

---

## Acceptance Criteria Summary

| Initiative | Criterion 1 | Criterion 2 | Criterion 3 | Criterion 4 |
|-----------|-----------|-----------|-----------|-----------|
| **Preview Envs** | Every PR has preview URL | Seeded & usable | Destroyed on close | Testnet enforced |
| **Architecture** | C4 L1-L3 exist | 5 sequences exist | Mermaid source | CI renders & verifies |
| **Crypto Spec** | Spec written | Domain tags differ | Same vectors pass all 3 | Changes fail tests |

---

## Key Risks & Mitigations

### Preview Environments
- **Risk**: Cost overrun with many concurrent previews
- **Mitigation**: Hard cap on concurrent environments, cost alerts

### Architecture Diagrams
- **Risk**: Diagrams become stale quickly
- **Mitigation**: Store as code (Mermaid), diff in review, update in PR

### Crypto Spec
- **Risk**: Test vectors are incorrect
- **Mitigation**: Have cryptographer review spec before generating vectors

---

## Files Changed

```
.kiro/specs/README.md                              (new)
.kiro/specs/01-preview-environments.md             (new)
.kiro/specs/02-system-architecture-diagrams.md     (new)
.kiro/specs/03-cryptographic-specification.md      (new)
```

**Commit**: `52e015d` - "feat: add architectural initiative specs"

---

## Questions?

Review each spec's "Open Questions" section for areas needing clarification or team discussion.

All specs are ready for design phase refinement.

