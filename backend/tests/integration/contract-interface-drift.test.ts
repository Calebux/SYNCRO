/**
 * Backend ↔ deployed contract interface drift detection (Backlog #75).
 *
 * Fails CI when backend invoke bindings reference Soroban methods or argument
 * counts that do not match the canonical contract interface manifest.
 */

import {
  SOROBAN_CONTRACT_INTERFACES,
  findContractFunction,
} from '../../../shared/src/soroban-contract-interfaces';
import { getBackendContractBindings } from '../../src/blockchain/backend-contract-bindings';

describe('Contract interface drift detection', () => {
  it('manifest covers every contract targeted by backend bindings', () => {
    const manifestContracts = new Set(
      SOROBAN_CONTRACT_INTERFACES.map((c) => c.contract),
    );
    const bindings = getBackendContractBindings();

    for (const binding of bindings) {
      expect(manifestContracts.has(binding.contract)).toBe(true);
    }
  });

  it('every backend binding method exists on the declared contract interface', () => {
    const bindings = getBackendContractBindings();

    for (const binding of bindings) {
      const fn = findContractFunction(binding.contract, binding.method);
      expect(fn).toBeDefined();
      expect(fn!.name).toBe(binding.method);
    }
  });

  it('backend binding argument counts match deployed contract signatures', () => {
    const bindings = getBackendContractBindings();

    for (const binding of bindings) {
      const fn = findContractFunction(binding.contract, binding.method)!;
      expect(binding.expectedArgKinds.length).toBe(fn.args.length);
    }
  });

  it('no duplicate Soroban method names within a single contract in the manifest', () => {
    for (const iface of SOROBAN_CONTRACT_INTERFACES) {
      const names = iface.functions.map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('detects drift when a binding references a non-existent method', () => {
    const fakeBinding = {
      operation: 'test_drift',
      contract: 'SubscriptionRegistry',
      method: 'nonexistent_method_xyz',
      expectedArgKinds: [] as string[],
    };

    const fn = findContractFunction(fakeBinding.contract, fakeBinding.method);
    expect(fn).toBeUndefined();
  });
});
