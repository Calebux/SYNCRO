/**
 * Single-flight (promise cache) to prevent concurrent execution of the same operation
 * for the same key.
 */
export class SingleFlight<T> {
  private inflight = new Map<string, Promise<T>>();

  /**
   * Execute the given function once per key. If called concurrently with the same key,
   * all callers will share the same promise.
   *
   * @param key Unique key for the operation
   * @param fn The function to execute
   * @returns The result of fn
   */
  async do(key: string, fn: () => Promise<T>): Promise<T> {
    // Check if there's already an in-flight promise for this key
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    // Create a new promise and store it
    const promise = fn().finally(() => {
      // Remove the promise from the map once it settles
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}
