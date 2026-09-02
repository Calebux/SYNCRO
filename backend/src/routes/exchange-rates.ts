import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { isSupportedCurrency } from '../constants/currencies';
import { ExchangeRateService } from '../services/exchange-rate/exchange-rate-service';
import { BadRequestError } from '../errors';
import { supabase } from '../config/database';

export function createExchangeRatesRouter(exchangeRateService: ExchangeRateService): Router {
  const router = Router();

  /**
   * GET /api/exchange-rates
   */
  // VALIDATION_BYPASS: Manual validation for supported currency
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    const base = (req.query.base as string) || 'USD';

    if (!isSupportedCurrency(base)) {
      throw new BadRequestError(`Unsupported currency: ${base}`);
    }

    const data = await exchangeRateService.getExchangeRateResponse(base);

    res.json({
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        // Explicit, top-level staleness signal so clients rendering converted
        // totals can surface a "rates may be outdated" indicator without having
        // to inspect the nested `data.source`.
        stale: data.stale,
        source: data.source,
        ageMs: data.ageMs,
      },
    });
  });

  /**
   * GET /api/exchange-rates/history
   * Admin only. Returns recent exchange rate snapshots from the history table.
   */
  router.get('/history', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);
    const base = req.query.base as string | undefined;

    let query = supabase
      .from('exchange_rate_history')
      .select('id, base_currency, rates, source, fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(limit);

    if (base) {
      query = query.eq('base_currency', base.toUpperCase());
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch exchange rate history: ${error.message}`);
    }

    res.json({
      success: true,
      data,
      meta: { timestamp: new Date().toISOString(), count: data?.length ?? 0 },
    });
  });

  return router;
}
