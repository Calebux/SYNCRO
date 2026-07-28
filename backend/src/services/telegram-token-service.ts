/**
 * TELEGRAM TOKEN SERVICE
 * ======================
 * Manages Telegram integration tokens with AES-256-GCM encryption at rest,
 * following the same pattern as GmailTokenService (#646 / issue #1076).
 *
 * All access_token values stored in user_telegram_connections are encrypted
 * before being written to Supabase.  Decryption only occurs in-process when
 * the token is actively needed for an API call.
 *
 * Revocation: disconnecting a user purges the encrypted token from the DB and
 * (where applicable) calls the Telegram Bot API to revoke webhooks/sessions.
 */

import { encrypt, decrypt } from '../utils/encryption';
import { supabase } from '../config/database';
import logger from '../config/logger';

export interface TelegramConnectionRow {
  id: string;
  user_id: string;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  access_token: string | null; // AES-256-GCM encrypted ciphertext
  created_at: string;
  updated_at: string;
}

export class TelegramTokenService {
  /**
   * Upsert a Telegram connection, encrypting the token before persistence.
   * Pass `accessToken = null` for deep-link-only connections where no token
   * is available.
   */
  static async upsertConnection(params: {
    userId: string;
    chatId: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    accessToken?: string | null;
  }): Promise<void> {
    const { userId, chatId, username, firstName, lastName, accessToken } = params;

    const encryptedToken =
      accessToken && accessToken.trim().length > 0
        ? encrypt(accessToken)
        : null;

    const { error } = await supabase
      .from('user_telegram_connections')
      .upsert(
        {
          user_id: userId,
          chat_id: chatId,
          username: username ?? null,
          first_name: firstName ?? null,
          last_name: lastName ?? null,
          access_token: encryptedToken,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (error) {
      logger.error('[TelegramTokenService] Failed to upsert connection', { userId, error });
      throw error;
    }

    logger.info('[TelegramTokenService] Connection upserted (token encrypted at rest)', {
      userId,
      chatId,
      hasToken: encryptedToken !== null,
    });
  }

  /**
   * Retrieve and decrypt the access token for a user.
   * Returns null when no token is stored for the user.
   */
  static async getDecryptedToken(userId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('user_telegram_connections')
      .select('access_token')
      .eq('user_id', userId)
      .single();

    if (error || !data?.access_token) {
      return null;
    }

    return decrypt(data.access_token);
  }

  /**
   * Disconnect a Telegram account:
   * 1. Decrypt the stored token (if any).
   * 2. Attempt remote revocation via Telegram Bot API.
   * 3. Delete the row from the database regardless of revocation outcome.
   *
   * This mirrors GmailTokenService.disconnectGmailAccount() — even if remote
   * revocation fails we always remove local credentials.
   */
  static async disconnectUser(userId: string): Promise<void> {
    const { data: connection } = await supabase
      .from('user_telegram_connections')
      .select('*')
      .eq('user_id', userId)
      .single<TelegramConnectionRow>();

    if (!connection) {
      logger.info('[TelegramTokenService] No connection found for user, nothing to revoke', {
        userId,
      });
      return;
    }

    // Attempt remote revocation when a token is present.
    if (connection.access_token) {
      try {
        const plainToken = decrypt(connection.access_token);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken && plainToken) {
          // Telegram Bot API: logOut revokes the bot session for this user.
          const response = await fetch(
            `https://api.telegram.org/bot${encodeURIComponent(botToken)}/logOut`,
            { method: 'POST' },
          );
          if (!response.ok) {
            logger.warn('[TelegramTokenService] Remote revocation returned non-OK', {
              userId,
              status: response.status,
            });
          } else {
            logger.info('[TelegramTokenService] Remote revocation succeeded', { userId });
          }
        }
      } catch (revokeErr) {
        // Non-fatal — we still remove local credentials below.
        logger.warn('[TelegramTokenService] Remote revocation failed (continuing)', {
          userId,
          error: revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
        });
      }
    }

    // Remove local credentials unconditionally.
    const { error: deleteError } = await supabase
      .from('user_telegram_connections')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      logger.error('[TelegramTokenService] Failed to delete connection row', {
        userId,
        error: deleteError,
      });
      throw deleteError;
    }

    logger.info('[TelegramTokenService] Connection deleted, token purged', { userId });
  }

  /**
   * Look up the chat_id for a user without decrypting any tokens.
   */
  static async getChatId(userId: string): Promise<string | null> {
    const { data } = await supabase
      .from('user_telegram_connections')
      .select('chat_id')
      .eq('user_id', userId)
      .single();

    return data?.chat_id ?? null;
  }
}
