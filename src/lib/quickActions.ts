/** The preset shares a cook can report as wasted without typing a number. */
export const WASTE_SHARES: { share: number; label: string }[] = [
  { share: 0.25, label: '¼' },
  { share: 0.5, label: '½' },
  { share: 1, label: 'הכל' },
];

/** Stock left after wasting `share` of what is on hand — never negative, and rounded so a
 * quarter of 3.5 does not come out as 2.6250000000000004 in the stock column. */
export function stockAfterWaste(current: number, share: number): number {
  const left = current * (1 - Math.min(Math.max(share, 0), 1));
  return Math.max(0, Math.round(left * 100) / 100);
}
