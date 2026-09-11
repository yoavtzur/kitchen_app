import { describe, expect, it } from 'vitest';
import { resolveAxis, shouldComplete, swipeProgress } from '../swipe';

describe('resolveAxis', () => {
  it('stays undecided inside the dead zone', () => {
    expect(resolveAxis(3, 2)).toBe('undecided');
    expect(resolveAxis(0, 0)).toBe('undecided');
  });

  it('picks horizontal when dx dominates past the dead zone', () => {
    expect(resolveAxis(30, 4)).toBe('horizontal');
  });

  it('picks vertical when dy dominates past the dead zone', () => {
    expect(resolveAxis(4, 30)).toBe('vertical');
  });

  it('breaks a tie toward vertical so scrolling wins by default', () => {
    expect(resolveAxis(20, 20)).toBe('vertical');
  });
});

describe('swipeProgress', () => {
  it('is 0 with no travel', () => {
    expect(swipeProgress(0, 300)).toBe(0);
  });

  it('scales linearly with card width', () => {
    expect(swipeProgress(150, 300)).toBeCloseTo(0.5);
    expect(swipeProgress(-75, 300)).toBeCloseTo(-0.25);
  });

  it('clamps to [-1, 1] beyond the card width', () => {
    expect(swipeProgress(600, 300)).toBe(1);
    expect(swipeProgress(-600, 300)).toBe(-1);
  });

  it('is 0 for a non-positive card width', () => {
    expect(swipeProgress(150, 0)).toBe(0);
    expect(swipeProgress(150, -10)).toBe(0);
  });
});

describe('shouldComplete', () => {
  it('is false below the 40% fraction on a wide card', () => {
    expect(shouldComplete(100, 400)).toBe(false);
  });

  it('is true at or past the 40% fraction on a wide card', () => {
    expect(shouldComplete(160, 400)).toBe(true);
    expect(shouldComplete(-160, 400)).toBe(true);
  });

  it('falls back to the pixel floor on a narrow card', () => {
    // 40% of 100px is 40px, well under the 96px floor.
    expect(shouldComplete(50, 100)).toBe(false);
    expect(shouldComplete(96, 100)).toBe(true);
  });

  it('is direction-agnostic', () => {
    expect(shouldComplete(-200, 400)).toBe(true);
  });
});
