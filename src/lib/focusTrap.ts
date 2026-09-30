/** The focusable-element selector a trap collects its candidates with.
 *
 * `[tabindex]:not([tabindex="-1"])` is what picks up TaskRow's `role="checkbox"` div and anything
 * else made focusable by hand rather than by being a native control. Elements disabled or
 * explicitly removed from the tab order are excluded here rather than filtered later, so the
 * list a caller passes to `nextFocusTarget` is already the tab ring. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where Tab should land inside a trap, or `null` to let the browser do what it would anyway.
 *
 * This is the whole decision a focus trap makes, split out from the DOM so it can be tested in
 * node like the rest of this codebase (see the note on jsdom in CLAUDE.md). The component keeps
 * the parts that genuinely need a browser — querying for candidates, reading `document.activeElement`,
 * calling `.focus()` — and asks this function only "given the ring and where I am, where next?".
 *
 * `null` rather than "the next element" in the common case is deliberate: re-implementing forward
 * tabbing would mean re-deriving the browser's own order, and getting it subtly wrong for every
 * element in the middle of the ring. Only the two ends need intercepting, because only there does
 * the browser want to leave the sheet.
 *
 * @param focusable The trap's focusable elements, in document order.
 * @param active    The element focus is currently on — typically `document.activeElement`.
 * @param shiftKey  Whether Shift is held, i.e. tabbing backwards.
 */
export function nextFocusTarget<T>(focusable: readonly T[], active: T | null, shiftKey: boolean): T | null {
  if (focusable.length === 0) return null;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  // Focus has escaped the trap entirely (an outside click, or a control that was removed from the
  // DOM while focused). Pull it back to whichever end the gesture is heading for, rather than
  // leaving Tab to walk the page behind the sheet.
  if (active === null || !focusable.includes(active)) {
    return shiftKey ? last : first;
  }

  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;

  // Somewhere in the middle: the browser's own next/previous is already correct.
  return null;
}
