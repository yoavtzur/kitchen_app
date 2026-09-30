import { useEffect, useId, useRef, type ReactNode } from 'react';
import { FOCUSABLE_SELECTOR, nextFocusTarget } from '../lib/focusTrap';

/**
 * Every sheet currently mounted, innermost last.
 *
 * Sheets nest for real in this app — `RecipeEditor`'s edit sheet opens a `ConfirmDialog` (itself a
 * `BottomSheet`) over itself, `StockCount`'s ingredient sheet opens two, and a `NumberEditor`
 * inside any sheet opens another. Without a stack, every one of those pairs misbehaves in the same
 * way: one Escape closes both sheets at once, and the outer sheet's focus trap fights the inner
 * one's, yanking focus back out of the dialog the cook is actually looking at.
 *
 * So both behaviours are gated on "am I the topmost sheet" rather than "am I a sheet". Module
 * state rather than context on purpose: a sheet needs to know about sheets that are not its
 * ancestors (two siblings rendered by the same screen), which a provider above it cannot express.
 */
const sheetStack: string[] = [];

/** `body`'s own `overflow` from before any sheet touched it, saved when the stack goes empty → 1.
 *
 * Module state rather than a per-sheet ref because the lock belongs to the stack, not to any one
 * sheet. A sheet that saved the value it happened to see on mount would save `'hidden'` whenever
 * another sheet was already open, and then restore *that* on the way out — so two sheets opened
 * and closed in the wrong order (two siblings on one screen, not just a parent and its child)
 * would leave the page permanently unable to scroll. */
let overflowBeforeFirstSheet = '';

export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Doubles as this sheet's identity in the stack above: React already guarantees it is stable
  // across renders and unique per mounted instance, which is exactly what the stack needs, so
  // there is no second id to keep in sync with it.
  const id = useId();
  const titleId = `${id}-title`;
  // Held in a ref rather than read at cleanup time, because by the time this sheet closes the
  // element that opened it may be gone (deleting a row from inside its own detail sheet).
  const openerRef = useRef<Element | null>(null);

  // Register in the stack, lock the page behind, and put focus somewhere useful. One effect
  // because all three are the same event — this sheet becoming the thing on screen — and their
  // cleanups have to run in the reverse order of their setup.
  useEffect(() => {
    openerRef.current = document.activeElement;

    // The page behind must not scroll under the sheet. Gated on being the first sheet on the way
    // in and the last on the way out, so an inner sheet closing never unlocks the page while its
    // parent is still open.
    if (sheetStack.length === 0) overflowBeforeFirstSheet = document.body.style.overflow;
    sheetStack.push(id);
    document.body.style.overflow = 'hidden';

    const sheet = sheetRef.current;
    // Several sheets render an `autoFocus` input, which React has already focused by now — moving
    // focus again would undo exactly the thing that screen asked for. Only take focus if nothing
    // inside the sheet has it.
    if (sheet && !sheet.contains(document.activeElement)) {
      const first = sheet.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      // Falling back to the container (which carries tabIndex={-1}) rather than leaving focus on
      // whatever is behind the overlay, where Tab would walk the page under the sheet.
      (first ?? sheet).focus();
    }

    return () => {
      const at = sheetStack.lastIndexOf(id);
      if (at !== -1) sheetStack.splice(at, 1);

      if (sheetStack.length === 0) document.body.style.overflow = overflowBeforeFirstSheet;

      // Hand focus back to whatever opened this sheet, so a cook using the keyboard resumes where
      // they left off instead of at the top of the document. An inner sheet lands back on its
      // parent sheet's control, which is what the nesting above should feel like.
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [id]);

  // Escape to close, and Tab kept inside. Listening on `document` rather than on the sheet
  // element so that both still work when focus is not inside the sheet at all — which happens
  // for real whenever a control is removed while focused (deleting a row from its own sheet)
  // and focus falls back to `body`. Gating on the stack is what makes a document-wide listener
  // safe: a nested sheet's parent sees every one of these events too, and must ignore them.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (sheetStack[sheetStack.length - 1] !== id) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;
      const sheet = sheetRef.current;
      if (!sheet) return;

      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        // A control inside a collapsed section of the sheet is `display: none`, which gives it a
        // null offsetParent — left in the ring it would be a dead stop where Tab appears to do
        // nothing at all.
        (el) => el.offsetParent !== null,
      );
      const active = document.activeElement;
      const target = nextFocusTarget(focusable, active instanceof HTMLElement ? active : null, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [id, onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Focusable only programmatically: the fallback target when a sheet holds nothing
        // focusable, never a stop in the tab ring itself.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700 }}>
            {title}
          </h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="סגור">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
