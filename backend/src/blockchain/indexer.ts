/**
 * blockchain/indexer.ts
 * Reliable Soroban event indexer that:
 * 1. Polls the RPC for new ledgers on a configurable interval.
 * 2. Detects gaps (missed blocks) by comparing the stored cursor against
 * the latest ledger and back-fills them in bounded batches.
 * 3. Persists every on-chain event to `blockchain_logs` so the table is
 * never missing a transaction.
 * 4. Normalizes contract topics into a canonical dotted path so downstream
 * consumers can rely on stable event names across contracts.
 * 5. Uses exponential back-off with jitter on transient RPC failures.
 */

import logger from '../config/logger';
import { supabase } from '../config/database';
import { RpcClient } from '../../../shared/src/rpc-client';
import {
  getBlockchainFlags,
  resolveStellarNetwork,
} from '../../../shared/blockchain-flags';
import fs from 'fs';
import path from 'path';