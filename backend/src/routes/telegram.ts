import express from 'express';
import { telegramCommandService } from '../services/telegram-command-service';
import logger from '../config/logger';

const router = express.Router();

/**
 * POST /api/v1/telegram/webhook
 *
 * Receives incoming updates from the Telegram Bot API.
 * Telegram must be configured to POST to this URL via `setWebhook`.
 * The route is intentionally unauthenticated — Telegraf validates the
 * secret_token header (TELEGRAM_WEBHOOK_SECRET) to confirm origin.
 */
router.post('/webhook', (req, res, next) => {
  const bot = telegramCommandService.getBot();

  if (!bot) {
    logger.warn('[TelegramRoute] Webhook received but bot is not initialised');
    res.sendStatus(503);
    return;
  }

  // Telegraf's built-in webhook callback — handles parsing and dispatching
  bot.handleUpdate(req.body, res).catch((err: unknown) => {
    logger.error('[TelegramRoute] Error handling webhook update', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  });
});

export default router;
