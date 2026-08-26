/**
 * @syncro/shared
 *
 * Shared domain models and types for Synchro application
 * Prevents type drift between client, backend, and SDK
 *
 * Type layers:
 *   generated/  — database rows (from migrations) and contract ABI types
 *   domain/     — hand-written concepts that exist in neither schema nor ABI
 */

// Generated database + contract types
export * from './generated';

// Subscription models (hand-written domain)
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

// Crypto utilities
export * from './crypto';

// Stealth address deterministic derivation
export * from './crypto/stealth-derive';

// Stealth meta-address format and helpers
export * from './types/stealth';

// Stealth payment audit types
export * from './types/stealth-payment';
