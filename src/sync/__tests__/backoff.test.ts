import { describe, expect, it } from 'vitest';
import { backoffMs, withJitter } from '../backoff';

describe('backoffMs', () => {
  it('doubles with each attempt, capped at 60s', () => {
    expect(backoffMs(1)).toBe(4000);
    expect(backoffMs(2)).toBe(8000);
    expect(backoffMs(3)).toBe(16000);
    expect(backoffMs(4)).toBe(32000);
    expect(backoffMs(5)).toBe(60000); // would be 64000 uncapped
    expect(backoffMs(10)).toBe(60000);
  });

  it('treats attempt 0 (or negative) the same as attempt 1', () => {
    expect(backoffMs(0)).toBe(4000);
    expect(backoffMs(-3)).toBe(4000);
  });
});

describe('withJitter', () => {
  it('stays within ±25% of the input for many samples', () => {
    for (let i = 0; i < 500; i++) {
      const ms = withJitter(4000);
      expect(ms).toBeGreaterThanOrEqual(3000);
      expect(ms).toBeLessThanOrEqual(5000);
    }
  });
});
