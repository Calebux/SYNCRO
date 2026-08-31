/**
 * useGasEstimate – React hook for fetching and displaying Stellar/Soroban
 * transaction cost estimates before signing.
 *
 * Usage:
 *   const { estimate, loading, error, refresh } = useGasEstimate({
 *     soroban: true,
 *     resources: { instructions: 2_000_000 },
 *   });
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  gasPredictor,
  type GasEstimate,
  type SorobanResourceEstimate,
} from "@/lib/gas-predictor";

interface UseGasEstimateOptions {
  /** If true, estimates a Soroban smart-contract tx. Otherwise a simple payment. */
  soroban?: boolean;
  /** Resource estimates for Soroban txs */
  resources?: SorobanResourceEstimate;
  /** User-defined alert threshold in XLM (defaults to predictor setting) */
  thresholdXlm?: number;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
}

interface UseGasEstimateResult {
  estimate: GasEstimate | null;
  loading: boolean;
  error: string | null;
  /** Manually refresh the estimate */
  refresh: () => Promise<void>;
  /** Whether the estimate exceeds the user's threshold */
  exceedsThreshold: boolean;
}

export function useGasEstimate(
  options: UseGasEstimateOptions = {},
): UseGasEstimateResult {
  const {
    soroban = false,
    resources,
    thresholdXlm,
    autoFetch = true,
  } = options;

  const [estimate, setEstimate] = useState<GasEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const fetchEstimate = useCallback(async () => {
    if (!isMounted.current) return;
    setLoading(true);
    setError(null);

    try {
      if (thresholdXlm !== undefined) {
        gasPredictor.setThreshold(thresholdXlm);
      }

      const result = soroban
        ? await gasPredictor.estimateSorobanTx(resources)
        : await gasPredictor.estimatePaymentTx();

      if (isMounted.current) {
        setEstimate(result);
      }
    } catch (err: any) {
      if (isMounted.current) {
        setError(err?.message || "Failed to fetch fee estimate");
        setEstimate(null);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [soroban, resources, thresholdXlm]);

  useEffect(() => {
    isMounted.current = true;
    if (autoFetch) {
      fetchEstimate();
    }
    return () => {
      isMounted.current = false;
    };
  }, [fetchEstimate, autoFetch]);

  return {
    estimate,
    loading,
    error,
    refresh: fetchEstimate,
    exceedsThreshold: estimate?.exceedsThreshold ?? false,
  };
}
