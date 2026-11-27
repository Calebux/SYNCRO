# Versioning Policy and Compatibility Matrix

This document defines how versions of the gateway API, the SDKs, and the on-chain contracts relate to each other, how long old versions are supported, and how deprecations are communicated. The compatibility matrix in this file is updated on every release.

## 1. Versioning scheme

### 1.1 SDKs (semver)

All SDKs follow [Semantic Versioning 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **MAJOR** is incremented for backward-incompatible changes to public APIs, types, or wire behavior.
- **MINOR** is incremented for backward-compatible feature additions.
- **PATCH** is incremented for backward-compatible bug fixes and internal changes.

Pre-release versions (`-alpha.N`, `-beta.N`, `-rc.N`) carry no compatibility guarantees.

### 1.2 Gateway API (path-versioned)

The gateway API is versioned in the URL path: `/v1/...`, `/v2/...`, and so on.

- The path major version changes only for breaking changes to request or response contracts.
- Within a path version, additive changes (new optional fields, new endpoints) are allowed. Clients must ignore unknown response fields.
- Clients may request a specific API revision with the header `X-API-Version: YYYY-MM-DD`. If omitted, the gateway uses the latest revision of the path version the client called.

### 1.3 Contracts

On-chain contracts are versioned as described in issue #1435. Each deployed contract exposes a `version()` view returning a semver string. A contract's major version is bumped when its storage layout or external ABI changes incompatibly; a new deployment with a new address is required for such changes.

## 2. Compatibility rules

- An SDK at version `X.Y.Z` is guaranteed to work with gateway API path version `vX` and with contract major version `X` as listed in the matrix below.
- An SDK may work with additional combinations, but these are not guaranteed.
- SDKs must not silently fall back to an unsupported gateway path version.

## 3. Support and deprecation window

| Artifact | Supported after successor release | Minimum notice before end of support |
|---|---|---|
| SDK major version | 12 months | 6 months |
| Gateway API path version | 12 months | 6 months |
| Contract major version | 12 months (for new integrations: no new deployments after successor) | 6 months |

### 3.1 Communication of deprecations

1. A deprecation is announced in the release notes of the release that introduces the successor, and in this document.
2. Deprecated SDK APIs emit a runtime or compile-time warning where the language supports it.
3. Deprecated gateway endpoints return the HTTP headers `Deprecation: true` and `Sunset: <HTTP-date>` on every response.
4. Final end-of-support dates are published at least 6 months in advance in the release notes, this document, and the developer changelog.

## 4. Compatibility matrix

Updated on every release. Status values: **Supported**, **Deprecated** (with sunset date), **End of life**.

| SDK version | Gateway API | Contract major | Status | Sunset date |
|---|---|---|---|---|
| SDK 3.x | `/v3` (`X-API-Version` latest) | 3 | Supported | - |
| SDK 2.x | `/v2` | 2 | Deprecated | To be set at successor release |
| SDK 1.x | `/v1` | 1 | End of life | - |

_Last updated: on initial publication of this policy. Subsequent releases must update this table._

## 5. Release checklist

Every release (SDK, gateway, or contract) must complete the following before publication:

- [ ] Determine the semver bump per Section 1 and confirm it matches the change set.
- [ ] Update the compatibility matrix in Section 4 with the new version, its gateway path version, its contract major version, and its status.
- [ ] If a version is being deprecated, set its sunset date (at least 6 months out) in the matrix and in the release notes.
- [ ] If a version reaches end of support, mark it **End of life** in the matrix.
- [ ] Confirm deprecation headers and runtime warnings are in place for any deprecated surface.
- [ ] Link the release notes from the matrix row.

## 6. Ownership

The release manager for each artifact is responsible for keeping this matrix accurate. Pull requests that change a release must include the corresponding matrix update, and reviewers should reject release PRs that omit it.
