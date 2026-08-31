# Spec: Cryptographic Specification and Cross-Implementation Testing

## Problem Statement

`commitment::compute_commitment` and `nullifier::compute_nullifier` are defined only in Rust (Soroban contracts), with no shared specification, no domain separation tag, and no cross-implementation test against the TypeScript side in `sdk/src/zk` and `shared/src/crypto`.

Current gaps:
- Commitment and nullifier derivations are defined only in Rust
- No explicit specification of field encoding or ordering
- No domain separation tags → commitment could be replayed as nullifier
- No cross-implementation test vectors
- Silent failures: derivations that differ by one byte fail silently as 'invalid proof'

Risks:
- Subtle bugs in TypeScript implementation go undetected
- Replay attacks if commitment and nullifier use same derivation
- Platform-specific differences (endianness, field encoding) cause inexplicable failures
- No visibility into what changed when derivation logic is modified

## Scope

Write a specification for both derivations including an explicit domain-separation tag and field encoding rules.
- Add distinct domain tags for commitments and nullifiers so a commitment can never be replayed as a nullifier
- Publish deterministic test vectors and assert them in Rust, in the SDK, and in shared
- Pin the vectors so any change to the derivation is a visible, reviewed breaking change

## Acceptance Criteria

- [ ] A written spec exists covering encoding, ordering and domain separation for both derivations
- [ ] Commitment and nullifier use different domain tags, enforced by a test
- [ ] The same test vectors pass in the Rust contract, the SDK and shared
- [ ] Changing a derivation fails the vector tests in all three places

## Key Files/Areas

- `backend/contracts/src/commitment.rs` (Rust - commitment contract)
- `backend/contracts/src/nullifier.rs` (Rust - nullifier contract)
- `sdk/src/zk/index.ts` (TypeScript - ZK SDK)
- `shared/src/crypto/index.ts` (TypeScript - shared crypto)
- `backend/docs/CRYPTO_SPEC.md` (new - specification)
- `backend/docs/CRYPTO_TEST_VECTORS.md` (new - test vectors)

## Requirements

### R1: Cryptographic Specification
Write a detailed specification document covering:

1. **Commitment Derivation**
   - Input fields and their types
   - Field ordering (canonical order, not code order)
   - Encoding rules (big-endian, little-endian, field element encoding)
   - Domain separation tag: `"COMMITMENT_V1"` or similar
   - Hash algorithm: SHA-256 or Keccak-256
   - Output field: base field or extension field
   - Example computation with sample inputs

2. **Nullifier Derivation**
   - Input fields and their types
   - Field ordering
   - Encoding rules
   - Domain separation tag: `"NULLIFIER_V1"` or similar (MUST differ from commitment)
   - Hash algorithm
   - Output field
   - Example computation with sample inputs

3. **Shared Components**
   - Field element encoding (how to serialize a field element to bytes)
   - Big-endian vs. little-endian conventions
   - Padding rules for variable-length inputs
   - UTF-8 encoding for string inputs
   - Null/empty value handling

4. **Why Domain Separation Matters**
   - Explain replay attack scenario
   - Show how domain tags prevent replays
   - Document the recommended tag format

### R2: Domain Separation Tags
Implement distinct domain tags:

**For Commitment:**
```
domain_tag = "COMMITMENT_V1"  // or similar
```

**For Nullifier:**
```
domain_tag = "NULLIFIER_V1"   // or similar, MUST be different
```

**Encoding in derivation:**
```
input = domain_tag || field1 || field2 || ... || fieldN
output = Hash(input)
```

Where `||` is concatenation.

### R3: Deterministic Test Vectors
Create a set of test vectors with:

1. **Sample Inputs** (5-10 test cases)
   - Trivial cases (all zeros, all ones)
   - Typical cases (random valid values)
   - Edge cases (field boundary values, max values)

2. **For Each Test Vector:**
   - Input values (in decimal and hex)
   - Expected output (in hex)
   - Explanation of why this test case matters

3. **Test Vector Format:**
```json
{
  "vectors": [
    {
      "id": "commitment_1",
      "type": "commitment",
      "inputs": {
        "field1": "0x1234...",
        "field2": "0x5678..."
      },
      "expected_output": "0xabcd...",
      "description": "Basic commitment with trivial inputs"
    },
    {
      "id": "nullifier_1",
      "type": "nullifier",
      "inputs": {
        "field1": "0x1234...",
        "field2": "0x5678..."
      },
      "expected_output": "0xabcd...",
      "description": "Basic nullifier with trivial inputs"
    }
  ]
}
```

### R4: Cross-Implementation Tests

**Rust Tests** (`backend/contracts/tests/crypto_spec.rs`):
```rust
#[test]
fn test_commitment_vectors() {
  let vectors = load_test_vectors();
  for vector in vectors.commitment {
    let output = compute_commitment(vector.inputs);
    assert_eq!(output, vector.expected_output);
  }
}

#[test]
fn test_nullifier_vectors() {
  let vectors = load_test_vectors();
  for vector in vectors.nullifier {
    let output = compute_nullifier(vector.inputs);
    assert_eq!(output, vector.expected_output);
  }
}

#[test]
fn test_commitment_nullifier_different() {
  // Same inputs should NOT produce same output
  let commitment = compute_commitment(...);
  let nullifier = compute_nullifier(...);
  assert_ne!(commitment, nullifier);
}
```

**TypeScript SDK Tests** (`sdk/src/zk/__tests__/crypto-spec.test.ts`):
```typescript
import { computeCommitment, computeNullifier } from '../index';
import testVectors from '../../../backend/docs/test-vectors.json';

describe('Crypto Spec Compliance', () => {
  test('commitment vectors', () => {
    for (const vector of testVectors.vectors.filter(v => v.type === 'commitment')) {
      const output = computeCommitment(vector.inputs);
      expect(output).toBe(vector.expected_output);
    }
  });

  test('nullifier vectors', () => {
    for (const vector of testVectors.vectors.filter(v => v.type === 'nullifier')) {
      const output = computeNullifier(vector.inputs);
      expect(output).toBe(vector.expected_output);
    }
  });

  test('commitment and nullifier differ with same inputs', () => {
    const inputs = { /* test inputs */ };
    const commitment = computeCommitment(inputs);
    const nullifier = computeNullifier(inputs);
    expect(commitment).not.toBe(nullifier);
  });
});
```

**Shared Crypto Tests** (`shared/src/crypto/__tests__/spec.test.ts`):
```typescript
import { commitmentSpec, nullifierSpec } from '../index';
import testVectors from '../../../backend/docs/test-vectors.json';

describe('Shared Crypto Spec', () => {
  // Same tests as SDK
});
```

### R5: Specification Document
Create `backend/docs/CRYPTO_SPEC.md`:

```markdown
# Cryptographic Specification

## Commitment Derivation

[Detailed specification]

## Nullifier Derivation

[Detailed specification]

## Domain Separation

[Explanation with examples]

## Field Encoding

[How field elements are encoded to bytes]

## Test Vectors

[Link to test vectors, explanation of each]

## Implementation Guide

[Step-by-step guide for implementers]
```

### R6: Test Vector Pinning
- Store test vectors in a shared location (`backend/docs/test-vectors.json`)
- Reference in all three test suites
- Any change to test vectors is a visible breaking change
- PR review must explicitly approve vector changes

### R7: CI Integration
- Commit that changes derivation logic must update test vectors
- PR fails if vectors are stale
- Documentation explains when/how to update vectors

## Design Decisions

- **Separate domain tags**: Prevents replay attacks, clear in specification
- **Shared test vectors**: Single source of truth, prevents divergence
- **Text-based specification**: Reviewable, can be referenced in code
- **Deterministic test vectors**: Can be hand-verified, portable across platforms

## Implementation Tasks

1. Extract commitment derivation logic from Rust contract
2. Extract nullifier derivation logic from Rust contract
3. Write cryptographic specification document
4. Generate deterministic test vectors (5-10 per function)
5. Add domain separation tags to both derivations
6. Implement tests in Rust with vector validation
7. Implement tests in SDK with vector validation
8. Implement tests in shared with vector validation
9. Set up CI to run cross-implementation tests
10. Document how to update test vectors

## Implementation Order

1. Write specification first (before changing any code)
2. Generate test vectors from current Rust implementation
3. Update Rust to add domain tags
4. Verify Rust tests pass
5. Update TypeScript SDK to add domain tags
6. Verify SDK tests pass
7. Update TypeScript shared to add domain tags
8. Verify shared tests pass
9. Pin test vectors in CI

## Dependencies

- Current Rust contract code (source of truth for test vectors)
- TypeScript SDK and shared modules
- Test framework access in all three implementations

## Risks & Mitigations

**Risk**: Changing derivation logic breaks compatibility
**Mitigation**: Test vectors change is a visible breaking change, requires explicit PR approval

**Risk**: TypeScript and Rust implementations drift
**Mitigation**: Shared test vectors catch divergence immediately

**Risk**: Test vectors are wrong
**Mitigation**: Have cryptographer review specification before generating vectors

## Open Questions

- What hash algorithm? (SHA-256, Keccak-256, Poseidon?)
- What field? (BLS12-381 scalar field, Starks field?)
- Should test vectors be generated randomly or hand-crafted?
- How many test vectors are sufficient? (5, 10, 100?)
- Should we include negative test cases (invalid inputs)?
- Should specification be in the repo or separate document?

## Success Metrics

- All three implementations produce identical outputs for all test vectors
- Commitment and nullifier outputs are always different
- Changing derivation logic causes test failures in all places
- New contributors can understand derivation without reading code
- Cryptographer review of specification is straightforward

