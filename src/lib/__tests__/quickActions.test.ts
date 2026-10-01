import { describe, expect, it } from 'vitest';
import { stockAfterWaste, WASTE_SHARES } from '../quickActions';

describe('stockAfterWaste', () => {
  it('takes the share off what is on hand', () => {
    expect(stockAfterWaste(8, 0.25)).toBe(6);
    expect(stockAfterWaste(8, 0.5)).toBe(4);
    expect(stockAfterWaste(8, 1)).toBe(0);
  });

  it('rounds away floating-point noise', () => {
    expect(stockAfterWaste(3.5, 0.25)).toBe(2.63);
  });

  it('never goes negative or reads a share outside 0..1 as more than all of it', () => {
    expect(stockAfterWaste(5, 2)).toBe(0);
    expect(stockAfterWaste(5, -1)).toBe(5);
    expect(stockAfterWaste(0, 0.5)).toBe(0);
  });

  it('offers quarter, half and all', () => {
    expect(WASTE_SHARES.map((s) => s.share)).toEqual([0.25, 0.5, 1]);
  });
});
