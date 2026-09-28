import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';

/**
 * A real screen rather than a silent `<Navigate to="/" />`.
 *
 * A redirect makes a broken link undebuggable: a cook following a stale bookmark or a mistyped
 * share link just lands on the home screen and reports "the link doesn't work", with nothing to
 * go on. Showing the path that didn't match turns that into a one-line bug report.
 */
export function NotFound() {
  const { pathname } = useLocation();
  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">הדף לא נמצא</h1>
      </div>
      <div className="card stack-gap-3">
        <p>הכתובת שהגעתם אליה לא קיימת באפליקציה.</p>
        <p className="muted" style={{ direction: 'ltr', textAlign: 'left' }}>
          {pathname}
        </p>
        <Link to="/" className="btn btn-primary" style={{ textAlign: 'center' }}>
          חזרה למסך הראשי
        </Link>
      </div>
    </div>
  );
}
