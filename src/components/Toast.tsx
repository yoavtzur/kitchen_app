/**
 * A transient confirmation, fixed just above the bottom nav.
 *
 * The three screens using this used to render the same `.pill green` inline, in document flow, at
 * the point the message happened to sit in the JSX. On `StockCount` that meant *below* a full
 * ingredient table: a cook tapped "שמור ספירה" in the sticky save bar at the bottom of the screen
 * and the confirmation appeared somewhere off the bottom of the document, where they never saw it.
 * Floating it fixes that, and is the reason this is a component rather than just a shared class.
 *
 * `role="status"` (an implicit `aria-live="polite"`) is the other half: a message that appears
 * silently and removes itself a couple of seconds later is invisible to a screen reader
 * otherwise, and "did that save?" is exactly the question it exists to answer.
 *
 * Rendering is the caller's decision — `{saved && <Toast …>}` — so the element enters and leaves
 * the tree with the message. That is what makes the live region announce: a region already in the
 * DOM whose text merely changes is announced, but only if the region was there long enough to be
 * registered, and these all appear in the same tick as their text.
 */
export function Toast({ message, tone = 'success' }: { message: string; tone?: 'success' | 'error' }) {
  return (
    <div className="toast" role="status">
      <span className={`pill ${tone === 'error' ? 'red' : 'green'}`}>{message}</span>
    </div>
  );
}
