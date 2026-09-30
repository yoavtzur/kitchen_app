/**
 * Placeholder while a lazily-loaded screen's chunk arrives.
 *
 * Deliberately not `BootScreen`: that one centres its message in a `minHeight: 60vh` box, so
 * swapping it for a real screen shifts everything on the page — measurable layout shift on the
 * one interaction where the cook is already waiting. This occupies roughly the shape of a screen
 * instead, so the content lands where the skeleton was.
 */
export function ScreenSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="screen-header">
        <div className="skeleton-block" style={{ width: 160, height: 28 }} />
      </div>
      <div className="card">
        <div className="skeleton-block" style={{ height: 18, marginBottom: 12 }} />
        <div className="skeleton-block" style={{ height: 18, width: '70%', marginBottom: 12 }} />
        <div className="skeleton-block" style={{ height: 18, width: '85%' }} />
      </div>
    </div>
  );
}
