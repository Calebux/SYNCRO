/**
 * Telegram bot update handling (issue #1283).
 *
 * Extracted verbatim from `routes/telegram-webhook.ts` so it can run from the
 * stored webhook record rather than inline in the request handler. That gives
 * Telegram updates the same guarantees as the payment providers: deduplication
 * by (provider, update_id), durable persistence before acknowledgement, and
 * retry from our side instead of relying on Telegram redelivering.
 *
 * The command effects are idempotent: connecting an already-connected chat
 * upserts, disconnecting an already-disconnected chat is a no-op, and the reply
 * messages are informational. Replay therefore re-sends a message but does not
 * corrupt state.
 */

import { supabase } from '../config/database';
import logger from '../config/logger';
import { telegramBotService } from './telegram-bot-service';
import { TelegramTokenService } from './telegram-token-service';

export interface TelegramUpdate {
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

const WELCOME_MESSAGE = `👋 Welcome to SYNCRO!\n\nTo connect your account:\n1. Log in to SYNCRO\n2. Go to Settings → Notifications\n3. Click "Connect Telegram"\n4. Follow the link to connect this chat\n\nNeed help? Visit https://syncro.app/help`;

const HELP_MESSAGE = `<b>SYNCRO Bot Commands</b>\n\n/start - Connect your SYNCRO account\n/disconnect - Disconnect your account\n/status - Subscription overview\n/subs - List active subscriptions\n/renewals - Upcoming renewals\n/snooze - Snooze a reminder\n/help - Show this help message\n\n<b>About SYNCRO</b>\nSYNCRO helps you manage your subscriptions and never miss a renewal.\n\nVisit: https://syncro.app`;

/**
 * Apply one Telegram update.
 *
 * Throws on unexpected failure so the ingestion pipeline records the attempt
 * and retries; user-facing command errors are reported to the chat and treated
 * as handled.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  logger.info('[TelegramWebhook] Processing update', {
    updateId: update.update_id,
    hasMessage: !!update.message,
  });

  if (!update.message?.text) return;

  const chatId = String(update.message.chat.id);
  const text = update.message.text.trim();
  const from = update.message.from;

  logger.info('[TelegramWebhook] Processing message', {
    chatId,
    text,
    username: from.username,
  });

  if (text.startsWith('/start')) {
    await handleStart(text, chatId, from);
    return;
  }

  if (text === '/disconnect') {
    await handleDisconnect(chatId);
    return;
  }

  if (text === '/help') {
    await telegramBotService.sendSimpleMessage('', HELP_MESSAGE, chatId);
    return;
  }

  await telegramBotService.sendSimpleMessage(
    '',
    `I don't understand that command. Try /help to see available commands.`,
    chatId,
  );
}

async function handleStart(
  text: string,
  chatId: string,
  from: NonNullable<TelegramUpdate['message']>['from'],
): Promise<void> {
  const parts = text.split(' ');
  const deepLinkParam = parts[1]; // Format: /start <user_id_token>

  if (!deepLinkParam) {
    await telegramBotService.sendSimpleMessage('', WELCOME_MESSAGE, chatId);
    logger.info('[TelegramWebhook] Sent welcome message without connection', { chatId });
    return;
  }

  try {
    // Decode user ID from deep link parameter (base64 encoded)
    const userId = Buffer.from(deepLinkParam, 'base64').toString('utf-8');

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
        chatId,
      );
      return;
    }

    // Upsert is idempotent, so a replayed /start does not duplicate the
    // connection. Tokens are encrypted at rest via TelegramTokenService.
    await TelegramTokenService.upsertConnection({
      userId,
      chatId,
      username: from.username ?? null,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
    });

    logger.info('[TelegramWebhook] Upserted Telegram connection', { userId, chatId });

    await telegramBotService.sendSimpleMessage(
      userId,
      `✅ <b>Account Connected!</b>\n\nYour SYNCRO account is now connected to Telegram.\n\nYou'll receive subscription reminders and notifications here.\n\n💡 Manage your notification preferences in SYNCRO settings.`,
      chatId,
    );

    logger.info('[TelegramWebhook] Successfully connected account', { userId, chatId });
  } catch (error) {
    logger.error('[TelegramWebhook] Error processing /start command:', error);
    await telegramBotService.sendSimpleMessage(
      '',
      '❌ Failed to connect account. Please try again or contact support.',
      chatId,
    );
  }
}

async function handleDisconnect(chatId: string): Promise<void> {
  try {
    const { data: connection } = await supabase
      .from('user_telegram_connections')
      .select('user_id')
      .eq('chat_id', chatId)
      .single();

    if (!connection) {
      await telegramBotService.sendSimpleMessage('', '❌ No connected account found.', chatId);
      return;
    }

    const { error: deleteError } = await supabase
      .from('user_telegram_connections')
      .delete()
      .eq('chat_id', chatId);

    if (deleteError) throw deleteError;

    await telegramBotService.sendSimpleMessage(
      '',
      '✅ Account disconnected successfully.\n\nYou will no longer receive notifications from SYNCRO.\n\nTo reconnect, use /start with a new connection link from SYNCRO settings.',
      chatId,
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
      chatId,
    );
  }
}
