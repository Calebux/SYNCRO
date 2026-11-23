import { describe, it, expect, jest } from '@jest/globals';
import { meteredTool, servedFreeStats } from '../src/provider/index.js';
import type {
  McpCallToolResult,
  McpToolExtra,
  McpToolHandler,
} from '../src/provider/mcp.js';

function ok(text = 'ok'): McpCallToolResult {
  return { content: [{ type: 'text', text }] };
}

function handler(impl: McpToolHandler = () => ok()): McpToolHandler & { mock: jest.Mock } {
  const mock = jest.fn(impl);
  return mock as unknown as McpToolHandler & { mock: jest.Mock };
}

function httpExtra(headers: Record<string, string>): McpToolExtra {
  return { requestInfo: { headers, url: 'https://mcp.example.com' } };
}

function decodeChallenge(result: McpCallToolResult): any {
  const encoded = (result._meta ?? {})['PAYMENT-REQUIRED'];
  expect(typeof encoded).toBe('string');
  return JSON.parse(atob(encoded as string));
}

describe('meteredTool', () => {
  it('runs a free tool and attaches a free receipt', async () => {
    const inner = handler();
    const wrapped = meteredTool(inner, 0, { toolName: 'ping' });

    const result = await wrapped({}, {});

    expect(inner.mock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    const receipt = (result._meta ?? {})['X-Syncro-Receipt'] as any;
    expect(receipt.status).toBe('free');
    expect(receipt.amount).toBe(0);
    expect(receipt.route).toBe('ping');
    expect(receipt.method).toBe('CALL');
  });

  it('returns an isError result carrying the x402 challenge when unpaid', async () => {
    const inner = handler();
    const wrapped = meteredTool(inner, 0.01, { toolName: 'summarize' });

    const result = await wrapped({}, {});

    expect(inner.mock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    const challenge = decodeChallenge(result);
    expect(challenge.x402Version).toBe(2);
    expect(challenge.resource.url).toBe('mcp://tool/summarize');
    expect(challenge.accepts).toEqual([
      { scheme: 'exact', amount: '0.01', asset: 'USDC', payTo: 'gateway' },
    ]);
  });

  it('accepts a proof from the HTTP transport header', async () => {
    const inner = handler();
    const wrapped = meteredTool(inner, 0.02, { toolName: 'summarize' });

    const result = await wrapped(
      {},
      httpExtra({ 'x-syncro-payment-proof': 'proof-http' }),
    );

    expect(inner.mock).toHaveBeenCalledTimes(1);
    const receipt = (result._meta ?? {})['X-Syncro-Receipt'] as any;
    expect(receipt.status).toBe('settled');
    expect(receipt.amount).toBe(0.02);
    expect(receipt.payer).toBe('proof-http');
  });

  it('accepts a proof from PAYMENT-SIGNATURE when no header is exposed', async () => {
    const inner = handler();
    const wrapped = meteredTool(inner, 0.02, { toolName: 'summarize' });

    const result = await wrapped({}, { _meta: { 'PAYMENT-SIGNATURE': 'proof-meta' } });

    expect(inner.mock).toHaveBeenCalledTimes(1);
    const receipt = (result._meta ?? {})['X-Syncro-Receipt'] as any;
    expect(receipt.payer).toBe('proof-meta');
  });

  it('mints a settled receipt only once the gateway verifies the proof', async () => {
    const inner = handler();
    const verifyProof = jest.fn<(proof?: string) => boolean>(() => false);
    const wrapped = meteredTool(inner, 0.05, {
      toolName: 'summarize',
      verifyProof,
    });

    const rejected = await wrapped({}, httpExtra({ 'x-syncro-payment-proof': 'bad' }));
    expect(inner.mock).not.toHaveBeenCalled();
    expect(rejected.isError).toBe(true);

    verifyProof.mockReturnValue(true);
    const accepted = await wrapped({}, httpExtra({ 'x-syncro-payment-proof': 'good' }));
    expect(inner.mock).toHaveBeenCalledTimes(1);
    expect((accepted._meta ?? {})['PAYMENT-REQUIRED']).toBeUndefined();
  });

  it('reports settled usage through meterCall', async () => {
    const meterCall = jest.fn();
    const wrapped = meteredTool(handler(), 0.03, { toolName: 'summarize', meterCall });

    await wrapped({}, httpExtra({ 'x-syncro-payment-proof': 'proof' }));

    expect(meterCall).toHaveBeenCalledTimes(1);
    expect(meterCall.mock.calls[0][0]).toMatchObject({ route: 'summarize', amount: 0.03, status: 'settled' });
  });

  it('matches per-tool pricing declarations case-insensitively', async () => {
    const wrapped = meteredTool(handler(), { 'CALL Summarize': 0.07, 'CALL ping': 0 }, { toolName: 'summarize' });

    const result = await wrapped({}, {});
    expect(decodeChallenge(result).accepts[0].amount).toBe('0.07');
  });

  it('rejects with retry metadata when metering fails on the default failure mode', async () => {
    const inner = handler();
    const wrapped = meteredTool(inner, 0.01, {
      toolName: 'summarize',
      verifyProof: () => {
        throw new Error('Gateway connection lost');
      },
    });

    const result = await wrapped({}, httpExtra({ 'x-syncro-payment-proof': 'proof' }));

    expect(inner.mock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result._meta ?? {})['Retry-After']).toBe('5');
  });

  it('serves free and counts the outage when failure mode is serve-free', async () => {
    const before = servedFreeStats.count;
    const inner = handler();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const wrapped = meteredTool(inner, 0.01, {
      toolName: 'summarize',
      onFailure: 'serve-free',
      verifyProof: () => {
        throw new Error('Gateway connection lost');
      },
    });

    const result = await wrapped({}, httpExtra({ 'x-syncro-payment-proof': 'proof' }));

    expect(inner.mock).toHaveBeenCalledTimes(1);
    expect(servedFreeStats.count).toBe(before + 1);
    expect((result._meta ?? {})['X-Syncro-Receipt']).toMatchObject({ status: 'free' });
    warn.mockRestore();
  });

  it('delegates to a custom failure handler', async () => {
    const onFailure = jest.fn(() => ({ isError: true, content: [{ type: 'text', text: 'custom' }] }));
    const wrapped = meteredTool(handler(), 0.01, {
      toolName: 'summarize',
      onFailure,
      verifyProof: () => {
        throw new Error('boom');
      },
    });

    const result = await wrapped({}, {});

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: 'text', text: 'custom' }]);
  });
});
