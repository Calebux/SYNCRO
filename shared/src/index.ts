/**
 * @syncro/shared
 *
 * Shared domain models and types for Synchro application.
 * Prevents type drift between client, backend, and SDK.
 *
 * Version: 1.0.0
 * Compatibility: Follows semantic versioning
 * - Major version: Breaking changes to domain models
 * - Minor version: New fields (backwards compatible)
 * - Patch version: Bug fixes, documentation
 *
 * --- Import layering ---
 *
 * This package is organized into three layers, and imports flow one way
 * only: types -> logic -> platform. A file in one layer may only import
 * from its own layer or a layer to its left; it must never import from a
 * layer to its right. This is enforced in CI (see eslint.config.mjs).
 *
 *   types/     Pure domain types and constants. No functions with logic,
 *              no imports from `logic/` or `platform/`.
 *   logic/     Pure functions and deterministic crypto operating on the
 *              types above. No network calls, no external SDKs, no
 *              process/env access. May import from `types/`.
 *   platform/  Adapters with real side effects or third-party SDK wiring
 *              (the RPC client, Sentry config). May import from `types/`
 *              and `logic/`.
 *
 * This barrel (the package root, `@syncro/shared`) intentionally
 * re-exports ONLY the types layer. Importing a type must never drag in
 * the RPC client or Sentry wiring. Everything else — crypto, subscription
 * math, security helpers, the RPC client, Sentry config, Stellar memo
 * helpers — is available only via its own explicit subpath, e.g.:
 *
 *   import { Subscription } from '@syncro/shared';
 *   import { deriveStealthAddress } from '@syncro/shared/crypto';
 *   import { calculateMonthlySpend } from '@syncro/shared/subscription-math';
 *   import { sanitizeUrl } from '@syncro/shared/security';
 *   import { RpcClient } from '@syncro/shared/rpc-client';
 *   import { buildRelease } from '@syncro/shared/sentry';
 *
 * See package.json `exports` for the full list of subpaths.
 */

// Subscription models
export * from './types/subscription';

// Payment models
export * from './types/payment';

// User models
export * from './types/user';

// Analytics models
export * from './types/analytics';

// Privacy feature flags
export * from './types/blockchain-flags';

// Domain events
export * from './domain-events';

// Canonical domain glossary and layer mapping specifications
export * from './types/domain-glossary';
