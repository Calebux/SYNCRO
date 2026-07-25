import logger from '../config/logger';
import { ExternalServiceClient } from '../utils/external-service-client';

const paystackClient = new ExternalServiceClient('paystack');
const PAYSTACK_BASE = 'https://api.paystack.co';
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ?? '';

async function paystackRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const json = await paystackClient.request<{ status: boolean; message: string; data: T }>(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!json.status) {
    throw new Error(`Paystack error: ${json.message}`);
  }

  return json.data;
}

export interface InitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/**
 * Initialize a Naira wallet funding transaction.
 * Returns a Paystack checkout URL the user completes in-browser.
 */
export async function initializeFunding(params: {
  email: string;
  amountKobo: number; // amount in kobo (100 kobo = ₦1)
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}): Promise<InitializeResult> {
  return paystackRequest<InitializeResult>('POST', '/transaction/initialize', {
    email: params.email,
    amount: params.amountKobo,
    reference: params.reference,
    callback_url: params.callbackUrl,
    currency: 'NGN',
    channels: ['card', 'bank', 'ussd', 'bank_transfer'],
    metadata: params.metadata,
  });
}

export interface VerifyResult {
  status: string; // 'success' | 'failed' | 'abandoned'
  reference: string;
  amount: number; // kobo
  currency: string;
  paid_at: string;
  customer: { email: string };
}

/**
 * Verify a completed transaction by reference.
 */
export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  return paystackRequest<VerifyResult>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
}

export interface SubAccount {
  id: number;
  subaccount_code: string;
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
}

/**
 * Create a Paystack sub-account (for split payments / team wallets).
 */
export async function createSubAccount(params: {
  businessName: string;
  settlementBank: string; // bank code e.g. "058" for GTBank
  accountNumber: string;
  percentageCharge: number; // 0–100
  description?: string;
}): Promise<SubAccount> {
  return paystackRequest<SubAccount>('POST', '/subaccount', {
    business_name: params.businessName,
    settlement_bank: params.settlementBank,
    account_number: params.accountNumber,
    percentage_charge: params.percentageCharge,
    description: params.description,
  });
}

/**
 * Fetch an existing sub-account by its code.
 */
export async function getSubAccount(subaccountCode: string): Promise<SubAccount> {
  return paystackRequest<SubAccount>('GET', `/subaccount/${encodeURIComponent(subaccountCode)}`);
}

/**
 * List supported Nigerian banks (useful for the sub-account setup form).
 */
export async function listBanks(): Promise<Array<{ name: string; code: string }>> {
  return paystackRequest<Array<{ name: string; code: string }>>('GET', '/bank?currency=NGN&country=nigeria');
}
