import {
  parseTraceparent,
  formatTraceparent,
  newTraceContext,
  childTraceContext,
  shouldSample,
} from '../src/lib/trace-context';

const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('trace-context', () => {
  it('round-trips a valid traceparent', () => {
    const ctx = parseTraceparent(VALID);
    expect(ctx).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    });
    expect(formatTraceparent(ctx!)).toBe(VALID);
  });

  it('rejects malformed and all-zero ids', () => {
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent('garbage')).toBeUndefined();
    expect(parseTraceparent(`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`)).toBeUndefined();
    expect(parseTraceparent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`)).toBeUndefined();
  });

  it('child keeps trace id and sampling but gets a new span', () => {
    const parent = newTraceContext(true);
    const child = childTraceContext(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.sampled).toBe(true);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(parseTraceparent(formatTraceparent(child))).toEqual(child);
  });

  it('always samples failures and settlements', () => {
    const never = () => 0.99;
    expect(shouldSample('failure', 0, undefined, never)).toBe(true);
    expect(shouldSample('settlement', 0, undefined, never)).toBe(true);
  });

  it('samples the hot path by rate unless upstream already sampled', () => {
    expect(shouldSample('success', 0.1, undefined, () => 0.05)).toBe(true);
    expect(shouldSample('success', 0.1, undefined, () => 0.5)).toBe(false);
    expect(shouldSample('success', 0, parseTraceparent(VALID), () => 0.5)).toBe(true);
  });
});
