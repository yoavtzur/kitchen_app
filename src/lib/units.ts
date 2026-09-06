import type { Unit } from '../types';

const WEIGHT: Unit[] = ['kg', 'g'];
const VOLUME: Unit[] = ['l', 'ml'];

function family(unit: Unit): 'weight' | 'volume' | 'unit' {
  if (WEIGHT.includes(unit)) return 'weight';
  if (VOLUME.includes(unit)) return 'volume';
  return 'unit';
}

const BASE_FACTOR: Record<Unit, number> = {
  kg: 1000,
  g: 1,
  l: 1000,
  ml: 1,
  unit: 1,
};

export function canConvert(a: Unit, b: Unit): boolean {
  return family(a) === family(b);
}

/** Converts `qty` from `from` to `to`. Returns null if units are not in the same family. */
export function convert(qty: number, from: Unit, to: Unit): number | null {
  if (from === to) return qty;
  if (!canConvert(from, to)) return null;
  const inBase = qty * BASE_FACTOR[from];
  return inBase / BASE_FACTOR[to];
}

const UNIT_LABELS: Record<Unit, string> = {
  kg: 'ק"ג',
  g: 'גרם',
  l: 'ליטר',
  ml: 'מ"ל',
  unit: "יח'",
};

export function unitLabel(unit: Unit): string {
  return UNIT_LABELS[unit];
}

export function formatQty(qty: number, unit: Unit): string {
  const rounded = Math.round(qty * 100) / 100;
  return `${rounded} ${unitLabel(unit)}`;
}
