import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { isSupportedCurrency } from '../constants/currencies';
import { ExchangeRateService } from '../services/exchange-rate/exchange-rate-service';
import logger from '../config/logger';

export function createExchangeRatesRouter(exchangeRateService: ExchangeRateService): Router {
  const router = Router();

  router.use(authenticate);

  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const base = (req.query.base as string) || 'USD';

      if (!isSupportedCurrency(base)) {
        return res.status(400).json({
          success: false,
          error: `Unsupported currency: ${base}`,
          meta: { timestamp: new Date().toISOString() },
        });
      }

      const data = await exchangeRateService.getExchangeRateResponse(base);

      res.json({
        success: true,
        data,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (error) {
      logger.error('Exchange rates error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch exchange rates',
        meta: { timestamp: new Date().toISOString() },
      });
    }
  });

  return router;
}
