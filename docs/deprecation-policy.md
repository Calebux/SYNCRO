# Deprecation Policy

This document defines how Syncro communicates and manages API and SDK deprecations.

---

## Deprecation Windows

| Change type | Minimum notice | Removal eligible after |
|-------------|---------------|------------------------|
| Non-breaking removal (optional field, additive endpoint) | 1 release cycle (~4 weeks) | Next minor version |
| Breaking change (required field, endpoint rename/removal) | 2 release cycles (~8 weeks) | Next major version |
| Authentication scheme change | 3 release cycles (~12 weeks) | Next major version |
| SDK major version drop | 2 release cycles (~8 weeks) | After successor SDK reaches stable |

A **release cycle** is approximately 4 weeks. Dates are announced in [api-changelog.md](./api-changelog.md) and the [sdk/CHANGELOG.md](../sdk/CHANGELOG.md).

---

## Process

### 1. Announce

When a feature is scheduled for removal:

- Add a `Deprecated` entry to [api-changelog.md](./api-changelog.md) under `[Unreleased]`.
- Add a `### Deprecated` section to [sdk/CHANGELOG.md](../sdk/CHANGELOG.md) for the next SDK release.
- Set the `sunset` response header on deprecated endpoints:
  ```
  Sunset: Sat, 01 Aug 2026 00:00:00 GMT
  Deprecation: true
  ```
- Log a deprecation warning in the SDK when the deprecated method is called.

### 2. Migrate

Provide a migration path in the changelog entry. Example:

> **Deprecated:** `GET /api/subscriptions?filter=` — use `?status=` instead. Removed in v2.0.0.

### 3. Remove

- Removal only happens in a **major** version bump for breaking changes.
- Non-breaking removals may happen in a minor version after the notice window.
- The removal entry moves from `Deprecated` to `Removed` in the changelog.

---

## Currently Deprecated

| Surface | Deprecated | Sunset | Migration |
|---------|------------|--------|-----------|
| Unversioned `/api/*` (legacy v1 payloads) | 2026-08-26 | **2027-02-26** | [v2 envelope contract](./api/v2-envelope.md) at `/api/v2` |
| `/api/v1/*` | 2026-08-26 | **2027-02-26** | Same handlers, frozen shape. Move clients to `/api/v2`. |

v1 response shapes stay unchanged until sunset. After 2027-02-26 v1 may return HTTP 410 or be removed in the next major backend release.

---

## SDK Compatibility Matrix

| SDK version | Backend version | Support status |
|-------------|----------------|----------------|
| `@syncro/sdk` v1.1.x | `synchro` v1.0.x – v1.1.x | ✅ Active |
| `@syncro/sdk` v1.0.x | `synchro` v1.0.x | ⚠️ Security fixes only |

SDK versions receive security fixes for one major version behind the current stable release.

---

## Questions

Open an issue or contact the backend team (see [CODEOWNERS](../.github/CODEOWNERS)).
