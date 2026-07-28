import { encrypt, decrypt } from '../utils/encryption';
import { supabase } from '../config/database';
import { ExternalServiceClient } from '../utils/external-service-client';
import { SingleFlight } from '../utils/single-flight';

type OutlookTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

const outlookClient = new ExternalServiceClient('outlook');
const singleFlight = new SingleFlight<string>();

export class OutlookTokenService {
  /**
   * Uses the stored encrypted refresh token to obtain and persist a new access token.
   * Single-flight: only one refresh per account at a time.
   */
  static async refreshAccessToken(userId: string): Promise<string> {
    // First, get the account id to use as the single-flight key
    const { data: account, error: fetchError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'outlook')
      .single();

    if (fetchError || !account || !account.refresh_token) {
      throw new Error('No valid Outlook credentials found for rotation');
    }

    const key = `outlook-refresh:${account.id}`;

    return singleFlight.do(key, async () => {
      // Re-fetch account inside the single-flight to get the latest
      const { data: latestAccount, error: latestFetchError } = await supabase
        .from('email_accounts')
        .select('*')
        .eq('id', account.id)
        .single();

      if (latestFetchError || !latestAccount || !latestAccount.refresh_token) {
        throw new Error('No valid Outlook credentials found for rotation');
      }

      const decryptedRefreshToken = decrypt(latestAccount.refresh_token);

      const tenant = process.env.MICROSOFT_TENANT_ID ?? 'common';
      const data = await outlookClient.request<OutlookTokenResponse>(
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
            client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
            refresh_token: decryptedRefreshToken,
            grant_type: 'refresh_token',
          }).toString(),
        },
      );

      const { access_token, refresh_token: newRefreshToken, expires_in } = data;

      const encryptedAccessToken = encrypt(access_token);
      const updateData: any = {
        access_token: encryptedAccessToken,
        token_expiry: new Date(Date.now() + expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (newRefreshToken) {
        updateData.refresh_token = encrypt(newRefreshToken);
      }

      await supabase
        .from('email_accounts')
        .update(updateData)
        .eq('id', latestAccount.id);

      return access_token;
    });
  }

  /**
   * Disconnects an Outlook account by purging local credentials.
   */
  static async disconnectOutlookAccount(userId: string): Promise<void> {
    const { data: account } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'outlook')
      .single();

    if (!account) return;

    // Purge local credentials
    await supabase
      .from('email_accounts')
      .delete()
      .eq('id', account.id);
  }
}
