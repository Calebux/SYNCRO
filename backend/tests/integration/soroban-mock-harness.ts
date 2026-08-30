/**
 * Mock Soroban RPC harness for backend-to-contract integration tests.
 * Captures contract.invoke parameters and simulates RPC success/failure modes.
 */

import { xdr } from '@stellar/stellar-sdk';

export interface CapturedContractCall {
  method: string;
  args: xdr.ScVal[];
}

export const captures: CapturedContractCall[] = [];

export const mockRpc = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
};

function buildSuccessfulSimulation() {
  return {
    transactionData: {
      build: () => ({}),
    },
    minResourceFee: '100',
    results: [{ auth: [] }],
  };
}

/** Extract Soroban invoke details from a built transaction. */
export function captureFromTransaction(tx: {
  operations?: Array<{ type?: string; func?: xdr.HostFunction }>;
}): void {
  const op = tx.operations?.[0];
  if (!op || op.type !== 'invokeHostFunction' || !op.func) {
    return;
  }

  const hostFn = op.func;
  if (hostFn.switch().name !== 'hostFunctionTypeInvokeContract') {
    return;
  }

  const invoke = hostFn.invokeContract();
  captures.push({
    method: invoke.functionName().toString(),
    args: invoke.args(),
  });
}

export function resetSorobanMocks(publicKey: string): void {
  captures.length = 0;
  mockRpc.getAccount.mockReset();
  mockRpc.simulateTransaction.mockReset();
  mockRpc.sendTransaction.mockReset();
  mockRpc.getTransaction.mockReset();

  mockRpc.getAccount.mockResolvedValue({
    accountId: () => publicKey,
    sequenceNumber: () => '1',
    incrementSequenceNumber: jest.fn(),
  });
  mockRpc.simulateTransaction.mockImplementation(async (tx: unknown) => {
    captureFromTransaction(tx as Parameters<typeof captureFromTransaction>[0]);
    return buildSuccessfulSimulation();
  });
  mockRpc.sendTransaction.mockResolvedValue({
    status: 'PENDING',
    hash: 'a'.repeat(64),
    errorResult: null,
  });
  mockRpc.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
}

export function setSimulationError(message: string): void {
  mockRpc.simulateTransaction.mockImplementation(async (tx: unknown) => {
    captureFromTransaction(tx as Parameters<typeof captureFromTransaction>[0]);
    return {
      error: message,
      events: [],
      latestLedger: 1,
    };
  });
}

export function setSendError(message: string): void {
  mockRpc.sendTransaction.mockResolvedValue({
    status: 'ERROR',
    hash: '',
    errorResult: message,
  });
}

/** Map an xdr.ScVal to a simplified kind label for assertions. */
export function scValKind(val: xdr.ScVal): string {
  return val.switch().name;
}
