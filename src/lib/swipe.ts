const DEAD_ZONE = 8;
const COMPLETE_FRACTION = 0.4;
const COMPLETE_MIN_PX = 96;

export type SwipeAxis = 'horizontal' | 'vertical' | 'undecided';

/** Decides which axis a gesture belongs to once it clears a small dead zone; below that, undecided. */
export function resolveAxis(dx: number, dy: number): SwipeAxis {
  if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** Clamped travel fraction (−1..1) driving the card's transform. */
export function swipeProgress(dx: number, cardWidth: number): number {
  if (cardWidth <= 0) return 0;
  return Math.max(-1, Math.min(1, dx / cardWidth));
}

/** Whether a released swipe has traveled far enough to count as a completion. */
export function shouldComplete(dx: number, cardWidth: number): boolean {
  const threshold = Math.max(cardWidth * COMPLETE_FRACTION, COMPLETE_MIN_PX);
  return Math.abs(dx) >= threshold;
}
