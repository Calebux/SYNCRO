import { generateKeyPairSync } from "node:crypto";
import {
  IndependentReceipt,
  signReceiptForTests,
  verifyReceipt,
} from "../src/v3/receipt.js";

function buildReceipt(overrides: Partial<IndependentReceipt> = {}): IndependentReceipt {
  const receipt: IndependentReceipt = {
    providerId: "provider-1",
    channelId: "channel-abc",
    nonce: "nonce-123",
    unit: "request",
    quantity: 5,
    exchangeRate: 1.2,
    amountMinor: 900,
    currency: "USD",
    rateCard: {
      request: 150,
      second: 10,
      minute: 20,
      hour: 1200,
    },
    issuedAt: "2026-09-24T10:10:00.000Z",
    signature: "",
  };
  return { ...receipt, ...overrides };
}

describe("v3 receipt verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("verifies a valid receipt fully offline", () => {
    const receipt = buildReceipt();
    receipt.signature = signReceiptForTests(receipt, privateKeyPem);

    const result = verifyReceipt({
      receipt,
      providerPublicKeyPem: publicKeyPem,
      expectedChannelId: receipt.channelId,
      expectedNonce: receipt.nonce,
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.derivedAmountMinor).toBe(900);
  });

  it("reports amount mismatch with a distinct named failure", () => {
    const receipt = buildReceipt({ amountMinor: 901 });
    receipt.signature = signReceiptForTests(receipt, privateKeyPem);

    const result = verifyReceipt({
      receipt,
      providerPublicKeyPem: publicKeyPem,
      expectedChannelId: receipt.channelId,
      expectedNonce: receipt.nonce,
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]?.code).toBe("AMOUNT_MISMATCH");
  });

  it("reports channel mismatch with a distinct named failure", () => {
    const receipt = buildReceipt();
    receipt.signature = signReceiptForTests(receipt, privateKeyPem);

    const result = verifyReceipt({
      receipt,
      providerPublicKeyPem: publicKeyPem,
      expectedChannelId: "channel-other",
      expectedNonce: receipt.nonce,
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]?.code).toBe("CHANNEL_MISMATCH");
  });

  it("reports nonce mismatch with a distinct named failure", () => {
    const receipt = buildReceipt();
    receipt.signature = signReceiptForTests(receipt, privateKeyPem);

    const result = verifyReceipt({
      receipt,
      providerPublicKeyPem: publicKeyPem,
      expectedChannelId: receipt.channelId,
      expectedNonce: "nonce-other",
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]?.code).toBe("NONCE_MISMATCH");
  });

  it("reports signature mismatch with a distinct named failure", () => {
    const receipt = buildReceipt();
    receipt.signature = signReceiptForTests(receipt, privateKeyPem).replace(/a/g, "b");

    const result = verifyReceipt({
      receipt,
      providerPublicKeyPem: publicKeyPem,
      expectedChannelId: receipt.channelId,
      expectedNonce: receipt.nonce,
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]?.code).toBe("INVALID_SIGNATURE");
  });
});
