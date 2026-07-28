import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { telegramBotService } from '../services/telegram-bot-service';
import { TelegramTokenService } from '../services/telegram-token-service';
import { webhookSignatureAlertService } from '../services/webhook-signature-alert-service';

const router = Router();

/**
 * Validate the X-Telegram-Bot-Api-Secret-Token header using constant-time
 * comparison to prevent timing-oracle attacks (issue #1069).
 * Rejects requests that don't carry the configured secret.
 * If TELEGRAM_WEBHOOK_SECRET is not set the check is skipped (dev/test).
 */
function validateWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    next();
    return;
  }
  const header = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof header !== 'string') {
    logger.warn('[TelegramWebhook] Missing secret token header', { ip: req.ip });
    webhookSignatureAlertService.recordFailure('telegram', { reason: 'missing_header' });
    res.sendStatus(403);
    return;
  }
  // Constant-time comparison — prevents timing oracle on the secret value.
  const secretBuf = Buffer.from(secret, 'utf8');
  const headerBuf = Buffer.from(header, 'utf8');
  const lengthsMatch = secretBuf.length === headerBuf.length;
  // Always call timingSafeEqual with equal-length buffers to avoid length leaks.
  const padded = lengthsMatch
    ? headerBuf
    : Buffer.concat([headerBuf, Buffer.alloc(Math.max(0, secretBuf.length - headerBuf.length))]).slice(0, secretBuf.length);
  const valid = lengthsMatch && crypto.timingSafeEqual(secretBuf, padded);
  if (!valid) {
    logger.warn('[TelegramWebhook] Invalid secret token', { ip: req.ip });
    webhookSignatureAlertService.recordFailure('telegram', { reason: 'invalid_secret' });
    res.sendStatus(403);
    return;
  }
  webhookSignatureAlertService.recordSuccess('telegram');
  next();
}

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from: {
            id: number;
            is_bot: boolean;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
        };
        chat: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            type: string;
        };
        date: number;
        text?: string;
    };
}

/**
 * POST /api/telegram/webhook
 * Webhook endpoint for Telegram bot updates
 * Handles /start command to connect user accounts
 */
router.post('/webhook', validateWebhookSecret, async (req: Request, res: Response) => {
    try {
        const update: TelegramUpdate = req.body;

        logger.info('[TelegramWebhook] Received update', {
            updateId: update.update_id,
            hasMessage: !!update.message,
        });

        // Handle incoming message
        if (update.message?.text) {
            const chatId = String(update.message.chat.id);
            const text = update.message.text.trim();
            const from = update.message.from;

            logger.info('[TelegramWebhook] Processing message', {
                chatId,
                text,
                username: from.username,
            });

            // Handle /start command with optional deep link parameter
            if (text.startsWith('/start')) {
                const parts = text.split(' ');
                const deepLinkParam = parts[1]; // Format: /start <user_id_token>

                if (!deepLinkParam) {
                    // No user ID provided - send instructions
                    await telegramBotService.sendSimpleMessage(
                        '', // No userId yet
                        `👋 Welcome to SYNCRO!\n\nTo connect your account:\n1. Log in to SYNCRO\n2. Go to Settings → Notifications\n3. Click "Connect Telegram"\n4. Follow the link to connect this chat\n\nNeed help? Visit https://syncro.app/help`,
                        chatId
                    );

                    logger.info('[TelegramWebhook] Sent welcome message without connection', {
                        chatId,
                    });

                    return res.status(200).json({ ok: true });
                }

                // Deep link parameter provided - connect account
                try {
                    // Decode user ID from deep link parameter (base64 encoded)
                    const userId = Buffer.from(deepLinkParam, 'base64').toString('utf-8');

                    // Validate user exists
                    const { data: user, error: userError } = await supabase
                        .from('profiles')
                        .select('id')
                        .eq('id', userId)
                        .single();

                    if (userError || !user) {
                        logger.warn('[TelegramWebhook] Invalid user ID in deep link', {
                            deepLinkParam,
                            error: userError,
                        });

                        await telegramBotService.sendSimpleMessage(
                            '',
                            '❌ Invalid connection link. Please generate a new link from SYNCRO settings.',
                            chatId
                        );

                        return res.status(200).json({ ok: true });
                    }

                    // Check if connection already exists
                    const { data: existing } = await supabase
                        .from('user_telegram_connections')
                        .select('id')
                        .eq('user_id', userId)
                        .single();

                    if (existing) {
                        // Update existing connection (tokens encrypted at rest via TelegramTokenService)
                        await TelegramTokenService.upsertConnection({
                            userId,
                            chatId,
                            username: from.username ?? null,
                            firstName: from.first_name,
                            lastName: from.last_name ?? null,
                        });

                        logger.info('[TelegramWebhook] Updated existing Telegram connection', {
                            userId,
                            chatId,
                        });
                    } else {
                        // Create new connection (tokens encrypted at rest via TelegramTokenService)
                        await TelegramTokenService.upsertConnection({
                            userId,
                            chatId,
                            username: from.username ?? null,
                            firstName: from.first_name,
                            lastName: from.last_name ?? null,
                        });

                        logger.info('[TelegramWebhook] Created new Telegram connection', {
                            userId,
                            chatId,
                        });
                    }

                    // Send success message
                    await telegramBotService.sendSimpleMessage(
                        userId,
                        `✅ <b>Account Connected!</b>\n\nYour SYNCRO account is now connected to Telegram.\n\nYou'll receive subscription reminders and notifications here.\n\n💡 Manage your notification preferences in SYNCRO settings.`,
                        chatId
                    );

                    logger.info('[TelegramWebhook] Successfully connected account', {
                        userId,
                        chatId,
                    });
                } catch (error) {
                    logger.error('[TelegramWebhook] Error processing /start command:', error);

                    await telegramBotService.sendSimpleMessage(
                        '',
                        '❌ Failed to connect account. Please try again or contact support.',
                        chatId
                    );
                }

                return res.status(200).json({ ok: true });
            }

            // Handle /disconnect command
            if (text === '/disconnect') {
                try {
                    const { data: connection } = await supabase
                        .from('user_telegram_connections')
                        .select('user_id')
                        .eq('chat_id', chatId)
                        .single();

                    if (!connection) {
                        await telegramBotService.sendSimpleMessage(
                            '',
                            '❌ No connected account found.',
                            chatId
                        );
                        return res.status(200).json({ ok: true });
                    }

                    const { error: deleteError } = await supabase
                        .from('user_telegram_connections')
                        .delete()
                        .eq('chat_id', chatId);

                    if (deleteError) {
                        throw deleteError;
                    }

                    await telegramBotService.sendSimpleMessage(
                        '',
                        '✅ Account disconnected successfully.\n\nYou will no longer receive notifications from SYNCRO.\n\nTo reconnect, use /start with a new connection link from SYNCRO settings.',
                        chatId
                    );

                    logger.info('[TelegramWebhook] Disconnected account', {
                        userId: connection.user_id,
                        chatId,
                    });
                } catch (error) {
                    logger.error('[TelegramWebhook] Error processing /disconnect command:', error);

                    await telegramBotService.sendSimpleMessage(
                        '',
                        '❌ Failed to disconnect account. Please try again.',
                        chatId
                    );
                }

                return res.status(200).json({ ok: true });
            }

            // Handle /help command
            if (text === '/help') {
                await telegramBotService.sendSimpleMessage(
                    '',
                    `<b>SYNCRO Bot Commands</b>\n\n/start - Connect your SYNCRO account\n/disconnect - Disconnect your account\n/status - Subscription overview\n/subs - List active subscriptions\n/renewals - Upcoming renewals\n/snooze - Snooze a reminder\n/help - Show this help message\n\n<b>About SYNCRO</b>\nSYNCRO helps you manage your subscriptions and never miss a renewal.\n\nVisit: https://syncro.app`,
                    chatId
                );

                return res.status(200).json({ ok: true });
            }

            // Unknown command - send help
            await telegramBotService.sendSimpleMessage(
                '',
                `I don't understand that command. Try /help to see available commands.`,
                chatId
            );
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('[TelegramWebhook] Error processing webhook:', error);
        // Always return 200 to Telegram to avoid retries
        res.status(200).json({ ok: true });
    }
});

/**
 * GET /api/telegram/webhook
 * Health check endpoint
 */
router.get('/webhook', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        message: 'Telegram webhook endpoint is active',
    });
});

export default router;
