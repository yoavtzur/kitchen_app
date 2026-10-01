import { describe, expect, it } from 'vitest';
import { telHref, whatsappHref } from '../phone';

describe('telHref', () => {
  it.each([
    ['050-1234567', 'tel:0501234567'],
    ['(03) 123-4567', 'tel:031234567'],
    ['+972 50 123 4567', 'tel:+972501234567'],
  ])('%s -> %s', (input, want) => {
    expect(telHref(input)).toBe(want);
  });
});

describe('whatsappHref', () => {
  it.each([
    ['050-1234567', 'https://wa.me/972501234567'],
    ['0501234567', 'https://wa.me/972501234567'],
    ['+972 50 123 4567', 'https://wa.me/972501234567'],
    ['00972501234567', 'https://wa.me/972501234567'],
    ['+1 (415) 555-0100', 'https://wa.me/14155550100'],
  ])('%s -> %s', (input, want) => {
    expect(whatsappHref(input)).toBe(want);
  });
});
