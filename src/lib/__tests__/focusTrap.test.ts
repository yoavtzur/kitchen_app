import { describe, expect, it } from 'vitest';
import { FOCUSABLE_SELECTOR, nextFocusTarget } from '../focusTrap';

// Plain strings stand in for elements: nextFocusTarget only ever compares identity, which is the
// point of it being generic — the decision needs no DOM, so it can be tested without one.
const ring = ['first', 'middle', 'last'];

describe('nextFocusTarget', () => {
  it('leaves the middle of the ring to the browser', () => {
    expect(nextFocusTarget(ring, 'middle', false)).toBeNull();
    expect(nextFocusTarget(ring, 'middle', true)).toBeNull();
  });

  it('wraps forward off the last element', () => {
    expect(nextFocusTarget(ring, 'last', false)).toBe('first');
  });

  it('wraps backward off the first element', () => {
    expect(nextFocusTarget(ring, 'first', true)).toBe('last');
  });

  it('does not wrap when tabbing away from an end into the ring', () => {
    expect(nextFocusTarget(ring, 'first', false)).toBeNull();
    expect(nextFocusTarget(ring, 'last', true)).toBeNull();
  });

  it('pulls focus back in when it has escaped the trap', () => {
    expect(nextFocusTarget(ring, 'somewhere-else', false)).toBe('first');
    expect(nextFocusTarget(ring, 'somewhere-else', true)).toBe('last');
    expect(nextFocusTarget(ring, null, false)).toBe('first');
    expect(nextFocusTarget(ring, null, true)).toBe('last');
  });

  it('has nowhere to send focus in an empty trap', () => {
    // A sheet always renders its own close button, so this is defensive rather than reachable —
    // but returning a target from an empty ring would mean calling .focus() on undefined.
    expect(nextFocusTarget([], null, false)).toBeNull();
    expect(nextFocusTarget([], 'anything', true)).toBeNull();
  });

  it('treats a single-element ring as both ends', () => {
    expect(nextFocusTarget(['only'], 'only', false)).toBe('only');
    expect(nextFocusTarget(['only'], 'only', true)).toBe('only');
  });
});

describe('FOCUSABLE_SELECTOR', () => {
  // Pinned rather than asserted loosely: the tabindex clause is what makes TaskRow's
  // role="checkbox" div reachable inside a sheet, and dropping it would silently shrink
  // the tab ring to native controls only.
  it('collects hand-rolled focusable elements, not just native controls', () => {
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it('excludes disabled controls from the ring', () => {
    for (const tag of ['button', 'input', 'select', 'textarea']) {
      expect(FOCUSABLE_SELECTOR).toContain(`${tag}:not([disabled])`);
    }
  });
});
