import { build } from 'esbuild';
import { generateKeyPairSync, sign } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

interface BrowserSdk {
  verifyReceiptInBrowser(
    value: unknown,
    keys: Array<{ keyId: string; publicKeyPem: string }>,
  ): Promise<{ ok: boolean; reason: string }>;
  createPaidFetch(config: {
    gatewayPublicKey: string;
    sign: (payload: string) => Promise<string>;
    fetchImpl: typeof fetch;
  }): typeof fetch;
}

type BrowserWithSdk = Window & { SyncroSdkBrowser: BrowserSdk };

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const receiptPayload = {
  receiptId: 'browser-receipt',
  requestHash: 'request-hash',
  route: '/v3/resource',
  unit: 'request',
  quantity: 1,
  amount: 12,
  rateCardVersion: 'v1',
  exchangeRate: null,
  channelId: 'channel-1',
  stateNonce: 4,
  timestamp: '2026-10-20T12:00:00.000Z',
  signerPublicKey: publicKeyPem,
  keyId: 'provider-key-1',
};

const receipt = {
  ...receiptPayload,
  signature: sign(null, Buffer.from(canonicalize(receiptPayload)), privateKey).toString('base64'),
};

let browserBundle: string;

test.beforeAll(async () => {
  const browserTestsDir = dirname(fileURLToPath(import.meta.url));
  const result = await build({
    entryPoints: [resolve(browserTestsDir, 'browser-entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'SyncroSdkBrowser',
    platform: 'browser',
    target: 'es2022',
    external: ['node:crypto'],
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error('SDK browser test bundle was not generated');
  browserBundle = output.text;
});

async function loadSdk(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.addScriptTag({ content: browserBundle });
}

test('verifies browser receipts with WebCrypto and rejects tampering', async ({ page }) => {
  await loadSdk(page);

  const results = await page.evaluate(async ({ receiptValue, key }) => {
    const sdk = (window as BrowserWithSdk).SyncroSdkBrowser;
    return Promise.all([
      sdk.verifyReceiptInBrowser(receiptValue, [key]),
      sdk.verifyReceiptInBrowser({ ...receiptValue, amount: 99 }, [key]),
    ]);
  }, {
    receiptValue: receipt,
    key: { keyId: 'provider-key-1', publicKeyPem },
  });

  expect(results).toEqual([
    { ok: true, reason: 'ok' },
    { ok: false, reason: 'bad_signature' },
  ]);
});

test('uses a WebCrypto signer with the browser paid-fetch entry', async ({ page }) => {
  await loadSdk(page);

  const result = await page.evaluate(async () => {
    const sdk = (window as BrowserWithSdk).SyncroSdkBrowser;
    const subtle = globalThis.crypto.subtle;
    const gatewayKeys = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const signerKeys = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const gatewayPem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(
      ...new Uint8Array(await subtle.exportKey('spki', gatewayKeys.publicKey)),
    ))}\n-----END PUBLIC KEY-----`;
    const signerPublicKey = await subtle.exportKey('raw', signerKeys.publicKey);
    const toBase64 = (bytes: ArrayBuffer): string =>
      btoa(String.fromCharCode(...new Uint8Array(bytes)));
    const canonicalize = (value: unknown): string => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
    };

    const challenge = {
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'stellar:testnet',
        amount: '1',
        asset: 'USDC',
        payTo: 'G_PROVIDER',
      }],
    };
    const challengeSignature = await subtle.sign(
      { name: 'Ed25519' },
      gatewayKeys.privateKey,
      new TextEncoder().encode(canonicalize(challenge)),
    );
    const paymentRequired = btoa(JSON.stringify({
      ...challenge,
      signature: toBase64(challengeSignature),
    }));

    let callCount = 0;
    const signedPaymentHeaders: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      callCount += 1;
      if (callCount === 1) {
        return new Response('payment required', {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': paymentRequired },
        });
      }

      const header = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
      if (!header) throw new Error('Paid fetch did not attach PAYMENT-SIGNATURE');
      signedPaymentHeaders.push(header);
      return new Response('paid', { status: 200 });
    };

    const paidFetch = sdk.createPaidFetch({
      gatewayPublicKey: gatewayPem,
      fetchImpl,
      sign: async (payload) => {
        const signature = await subtle.sign(
          { name: 'Ed25519' },
          signerKeys.privateKey,
          new TextEncoder().encode(payload),
        );
        return toBase64(signature);
      },
    });
    const response = await paidFetch('https://sdk.test/resource');
    const signedPaymentHeader = signedPaymentHeaders[0];
    if (!signedPaymentHeader) throw new Error('Paid fetch did not produce a signed payment');
    const signedPayment = JSON.parse(atob(signedPaymentHeader)) as {
      x402Version: number;
      accepted: unknown;
      payload: { signature: string };
    };

    const { signature } = signedPayment.payload;
    const valid = await subtle.verify(
      { name: 'Ed25519' },
      await subtle.importKey('raw', signerPublicKey, { name: 'Ed25519' }, false, ['verify']),
      Uint8Array.from(atob(signature), (character) => character.charCodeAt(0)),
      new TextEncoder().encode(canonicalize({
        x402Version: signedPayment.x402Version,
        accepted: signedPayment.accepted,
        payload: {},
      })),
    );

    return { status: response.status, callCount, valid };
  });

  expect(result).toEqual({ status: 200, callCount: 2, valid: true });
});
