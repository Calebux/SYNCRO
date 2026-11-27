import { SingleFlight } from '../src/utils/single-flight';

describe('SingleFlight', () => {
  it('should execute function only once for the same key, even with concurrent calls', async () => {
    const sf = new SingleFlight<string>();
    let callCount = 0;

    const fn = jest.fn(async () => {
      callCount++;
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'result';
    });

    // Launch 5 concurrent calls with the same key
    const promises = Array.from({ length: 5 }, () => sf.do('key1', fn));
    const results = await Promise.all(promises);

    // All promises should resolve to the same result
    expect(results.every(res => res === 'result')).toBe(true);
    // The function should have been called only once
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should execute function again after first call completes', async () => {
    const sf = new SingleFlight<number>();
    let callCount = 0;

    const fn = jest.fn(async () => {
      callCount++;
      return callCount;
    });

    // First call
    const result1 = await sf.do('key2', fn);
    expect(result1).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);

    // Second call after first completed
    const result2 = await sf.do('key2', fn);
    expect(result2).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should handle different keys independently', async () => {
    const sf = new SingleFlight<string>();
    const fnA = jest.fn(async () => 'A');
    const fnB = jest.fn(async () => 'B');

    const [resultA, resultB] = await Promise.all([
      sf.do('keyA', fnA),
      sf.do('keyB', fnB),
    ]);

    expect(resultA).toBe('A');
    expect(resultB).toBe('B');
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('should propagate errors to all callers', async () => {
    const sf = new SingleFlight<void>();
    const testError = new Error('Test error');
    const fn = jest.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      throw testError;
    });

    const promises = Array.from({ length: 3 }, () => sf.do('key-error', fn));
    await expect(Promise.all(promises)).rejects.toThrow(testError);
  });
});

