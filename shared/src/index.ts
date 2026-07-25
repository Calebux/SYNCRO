/**
 * @syncro/shared
 * 
 * Shared domain models and types for Synchro application
 * Prevents type drift between client, backend, and SDK
 * 
 * Version: 1.0.0
 * Compatibility: Follows semantic versioning
 * - Major version: Breaking changes to domain models
 * - Minor version: New fields (backwards compatible)
 * - Patch version: Bug fixes, documentation
 */

// Subscription models
export * from './subscription';

// Payment models
export * from './payment';

// User models
export * from './user';

// Analytics models
export * from './analytics';

// Shared subscription calculations
export * from './subscription-math';

// Shared security helpers
export * from './security';

// Common utilities
export * from './common';

// RPC Client
export * from './rpc-client';

// Sentry shared config
export * from './sentry';

// Soroban contract interfaces (backend ↔ contract compatibility)
export * from './soroban-contract-interfaces';

// Crypto utilities
export * from './crypto';

// Stealth address deterministic derivation
export * from './crypto/stealth-derive';

// Stealth meta-address format and helpers
export * from './types/stealth';

// Stealth payment audit types
export * from './types/stealth-payment';

// Stealth payment audit types
export * from './types/stealth-payment';
