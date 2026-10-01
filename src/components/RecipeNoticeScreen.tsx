import { CHANGE_LABELS, type PendingNotice } from '../lib/notices';

/**
 * What a cook sees, instead of the app, when the chef has changed a recipe they have not yet read.
 * One big button — "קראתי והבנתי" — clears everything on the list at once; nothing else on the
 * screen is tappable, and the nav is not rendered, so the only way forward is to acknowledge.
 */
export function RecipeNoticeScreen({
  pending,
  onAcknowledge,
}: {
  pending: PendingNotice[];
  onAcknowledge: () => void;
}) {
  return (
    <div className="notice-gate" role="alertdialog" aria-labelledby="notice-title">
      <div className="card stack-gap-3">
        <h1 id="notice-title" className="screen-title">
          השף עדכן {pending.length === 1 ? 'מתכון' : `${pending.length} מתכונים`}
        </h1>
        <p className="muted">קראו לפני שמתחילים להכין — הכמויות או השלבים השתנו.</p>
        <ul className="notice-list">
          {pending.map((n) => (
            <li key={n.recipeId}>
              <strong>{n.recipeName}</strong>
              <span className="muted">{n.changed.map((c) => CHANGE_LABELS[c]).join(' · ')}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-primary btn-block" onClick={onAcknowledge} autoFocus>
          קראתי והבנתי
        </button>
      </div>
    </div>
  );
}
