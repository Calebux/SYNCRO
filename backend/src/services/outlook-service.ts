import { parseSubscriptionEmail } from "./email-parser";
import { generateProofHash, hashContent } from "../../utils/proof-hashing";
import { metadataExtractionOnly } from "./email-scanner";
import type { RawScanResult } from "./email-scanner";
import { ExternalServiceClient } from "../utils/external-service-client";

const outlookClient = new ExternalServiceClient('outlook');
const OUTLOOK_SCOPES = ["offline_access", "User.Read", "Mail.Read"];

const KEYWORDS = [
  "subscription",
  "renewal",
  "invoice",
  "receipt",
  "billing",
  "charged",
  "trial",
  "membership",
  "plan",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface OutlookTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface OutlookProfile {
  mail?: string;
  userPrincipalName: string;
  displayName?: string;
}

interface ScanOutlookOptions {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  maxResults?: number;
}

interface TokenRequestParams {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
}

// ── Exported functions ────────────────────────────────────────────────────────

export function getOutlookAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI ?? "",
    response_mode: "query",
    scope: OUTLOOK_SCOPES.join(" "),
    prompt: "consent",
  });

  if (state) params.set("state", state);

  const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeOutlookCodeForTokens(
  code: string,
): Promise<OutlookTokenResponse> {
  return requestOutlookToken({
    code,
    grant_type: "authorization_code",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI ?? "",
  });
}

export async function refreshOutlookToken(
  refreshToken: string,
): Promise<OutlookTokenResponse> {
  return requestOutlookToken({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

export async function getOutlookProfile(
  accessToken: string,
): Promise<OutlookProfile> {
  return outlookClient.request<OutlookProfile>("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function scanOutlookSubscriptions({
  accessToken,
  refreshToken,
  expiresAt,
  maxResults = 50,
}: ScanOutlookOptions) {
  let token = accessToken;

  if (expiresAt && refreshToken && new Date(expiresAt) <= new Date()) {
    try {
      const refreshed = await refreshOutlookToken(refreshToken);
      token = refreshed.access_token;
      // In a real implementation we should also emit an event or callback to update the DB with the new tokens
    } catch (err: any) {
      if (err.message?.includes('invalid_grant') || err.message?.includes('interaction_required')) {
        throw new Error('AUTH_REVOKED: Outlook token rotation failed. Re-authentication required.');
      }
      throw err;
    }
  }

  const searchQuery = KEYWORDS.join(" OR ");
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$search", `"${searchQuery}"`);
  url.searchParams.set("$select", "id,subject,from,receivedDateTime,body");
  url.searchParams.set("$top", String(maxResults));

  const data = await outlookClient.request<{ value?: any[] }>(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: "eventual",
      Prefer: 'outlook.body-content-type="text"',
    },
    maxAttempts: 1,
  }).catch((err: Error) => {
    const detail = err.message.replace(/^External service outlook returned status \d+:\s*/, '');

    if (err.message.includes('status 401')) {
      throw new Error(`AUTH_REVOKED: Outlook message scan unauthorized: ${detail}`);
    }
    if (err.message.includes('status 429')) {
      throw new Error(`RATE_LIMITED: Outlook message scan throttled: ${detail}`);
    }
    throw err;
  });

  const results: RawScanResult[] = [];

  for (const message of data.value ?? []) {
    const subject = message.subject ?? null;
    const from =
      message.from?.emailAddress?.name ??
      message.from?.emailAddress?.address ??
      null;
    const receivedAt = message.receivedDateTime ?? null;
    let body: string | null = message.body?.content ?? "";

    const parsed = parseSubscriptionEmail({ subject, from, body });
    if (!parsed) continue;

    const contentHash = hashContent(body);
    // Discard raw email content after hashing/parsing
    body = null;

    const proofHash = generateProofHash({
      provider: "outlook",
      messageId: message.id,
      receivedAt,
      subject,
      from,
      amount: parsed.amount,
      currency: parsed.currency,
      interval: parsed.interval,
      contentHash,
    });

    results.push({
      provider: "outlook",
      messageId: message.id,
      threadId: null,
      receivedAt,
      subject,
      from,
      ...parsed,
      proof: {
        hash: proofHash,
        contentHash,
        algorithm: "sha256",
      },
    });
  }

  return metadataExtractionOnly(results);
}

// ── Internal helper ───────────────────────────────────────────────────────────

async function requestOutlookToken(
  params: TokenRequestParams,
): Promise<OutlookTokenResponse> {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    ...params,
  });

  const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";
  return outlookClient.request<OutlookTokenResponse>(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
}
