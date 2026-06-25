import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import { parseSubscriptionEmail } from "./email-parser";
import { generateProofHash, hashContent } from "../../utils/proof-hashing";
import { metadataExtractionOnly } from "./email-scanner";
import type { RawScanResult } from "./email-scanner";
import { EXTERNAL_SERVICE_POLICIES } from "../config/external-services";

const policy = EXTERNAL_SERVICE_POLICIES.gmail;
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

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

interface ScanGmailOptions {
  accessToken: string;
  refreshToken?: string;
  sinceDays?: number;
  maxResults?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPayload {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailPayload[];
}

// ── OAuth client factory ──────────────────────────────────────────────────────

function createOAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing Google OAuth environment variables");
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

// ── Exported service functions ────────────────────────────────────────────────

export function getGmailAuthUrl(state: string): string {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });
}

export async function exchangeGmailCodeForTokens(
  code: string,
): Promise<Credentials> {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function getGmailProfile(tokens: Credentials) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ 
    version: "v1", 
    auth: oauth2Client,
    timeout: policy.timeoutMs,
  });
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data;
}

export async function scanGmailSubscriptions({
  accessToken,
  refreshToken,
  sinceDays = 120,
  maxResults = 50,
}: ScanGmailOptions) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const gmail = google.gmail({ 
    version: "v1", 
    auth: oauth2Client,
    timeout: policy.timeoutMs,
  });
  const query = buildQuery(sinceDays);

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listResponse.data.messages ?? [];
  const results: RawScanResult[] = [];

  for (const message of messages) {
    const details = await gmail.users.messages.get({
      userId: "me",
      id: message.id!,
      format: "full",
    });

    const payload = (details.data.payload ?? {}) as GmailPayload;
    const headers = payload.headers ?? [];
    const subject = findHeader(headers, "Subject");
    const from = findHeader(headers, "From");
    const receivedAt =
      findHeader(headers, "Date") ??
      new Date(Number(details.data.internalDate) || Date.now()).toISOString();

    let body: string | null = extractTextFromPayload(payload);

    const parsed = parseSubscriptionEmail({ subject, from, body });
    if (!parsed) continue;

    const contentHash = hashContent(body);
    // Discard raw email content after hashing/parsing
    body = null;

    const proofHash = generateProofHash({
      provider: "gmail",
      messageId: details.data.id,
      receivedAt,
      subject,
      from,
      amount: parsed.amount,
      currency: parsed.currency,
      interval: parsed.interval,
      contentHash,
    });

    results.push({
      provider: "gmail",
      messageId: details.data.id ?? null,
      threadId: details.data.threadId ?? null,
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

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildQuery(sinceDays: number): string {
  const keywordQuery = KEYWORDS.map((keyword) => `"${keyword}"`).join(" OR ");
  const baseQuery = `(${keywordQuery})`;
  if (!sinceDays) return baseQuery;
  return `${baseQuery} newer_than:${sinceDays}d`;
}

function findHeader(headers: GmailHeader[], name: string): string {
  const match = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return match ? match.value : "";
}

function extractTextFromPayload(payload: GmailPayload): string {
  const parts = collectParts(payload);
  const plainParts = parts.filter((p) => p.mimeType === "text/plain");
  const htmlParts = parts.filter((p) => p.mimeType === "text/html");
  const sources = plainParts.length ? plainParts : htmlParts;

  const decoded = sources
    .map((part) => decodeBase64(part.body?.data))
    .filter(Boolean)
    .join("\n");

  if (plainParts.length) return decoded;

  return decoded.replace(/<[^>]+>/g, " ");
}

function collectParts(payload: GmailPayload): GmailPayload[] {
  const parts: GmailPayload[] = [];
  if (payload?.mimeType && payload.body?.data) {
    parts.push(payload);
  }
  if (Array.isArray(payload?.parts)) {
    for (const part of payload.parts) {
      parts.push(...collectParts(part));
    }
  }
  return parts;
}

function decodeBase64(data?: string): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}
