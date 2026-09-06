import { describe, expect, it } from 'vitest';
import { dayName, dayOfWeek, dayShortLabel } from '../date';

describe('dayOfWeek', () => {
  it('matches Date#getDay() (0=Sunday..6=Saturday)', () => {
    expect(dayOfWeek('2026-08-30')).toBe(0); // Sunday
    expect(dayOfWeek('2026-08-31')).toBe(1); // Monday
    expect(dayOfWeek('2026-09-04')).toBe(5); // Friday
    expect(dayOfWeek('2026-09-05')).toBe(6); // Saturday
  });
});

describe('dayName stays in sync with dayOfWeek', () => {
  it('names Friday and Saturday correctly', () => {
    expect(dayName('2026-09-04')).toBe('שישי');
    expect(dayName('2026-09-05')).toBe('שבת');
  });
});

describe('dayShortLabel', () => {
  it('returns one short label per weekday, 0 through 6', () => {
    expect(dayShortLabel(0)).toBe('א׳');
    expect(dayShortLabel(5)).toBe('ו׳');
    expect(dayShortLabel(6)).toBe('ש׳');
  });
});
