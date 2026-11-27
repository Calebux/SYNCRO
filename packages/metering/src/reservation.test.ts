import { describe, expect, it } from 'vitest';
import { ReservationLedger, type AllowanceStore } from './reservation';

function store(limit = 100): AllowanceStore & { used: number } {
  return {
    used: 0,
    limitFor: () => limit,
    usedBy(this: { used: number }) { return this.used; },
    recordUsage(this: { used: number }, _p, amount) { this.used += amount; },
  } as AllowanceStore & { used: number };
}

describe('ReservationLedger', () => {
  it('holds at admission so concurrent calls cannot both be admitted', () => {
    const l = new ReservationLedger(store(100));
    l.reserve('a', '/r', 60);
    expect(l.availableFor('a')).toBe(40);
    expect(() => l.reserve('a', '/r', 60)).toThrow(/Insufficient allowance/);
  });

  it('charges the actual and releases the difference', () => {
    const s = store();
    const l = new ReservationLedger(s);
    const r = l.reserve('a', '/r', 50);
    expect(l.commit(r.id, 10)).toEqual({ charged: 10, released: 40 });
    expect(s.used).toBe(10);
    expect(l.availableFor('a')).toBe(90);
  });

  it('records no usage when a failed call is released', () => {
    const s = store();
    const l = new ReservationLedger(s);
    l.release(l.reserve('a', '/r', 50).id);
    expect(s.used).toBe(0);
    expect(l.availableFor('a')).toBe(100);
  });

  it('never charges an abandoned reservation', () => {
    let now = 0;
    const s = store();
    const l = new ReservationLedger(s, 1_000, () => now);
    const r = l.reserve('a', '/r', 50);

    now = 1_001;
    expect(l.sweep()).toHaveLength(1);
    expect(s.used).toBe(0);
    expect(l.availableFor('a')).toBe(100);
    // A late commit fails loudly rather than mis-billing.
    expect(() => l.commit(r.id, 50)).toThrow(/is expired/);
  });

  it('rejects a commit above the hold', () => {
    const l = new ReservationLedger(store());
    const r = l.reserve('a', '/r', 10);
    expect(() => l.commit(r.id, 11)).toThrow(RangeError);
  });

  it('rejects a second settlement', () => {
    const l = new ReservationLedger(store());
    const r = l.reserve('a', '/r', 10);
    l.commit(r.id, 5);
    expect(() => l.commit(r.id, 5)).toThrow(/not held/);
    expect(() => l.release(r.id)).toThrow(/not held/);
  });
});
