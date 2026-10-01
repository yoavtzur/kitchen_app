import type { ReactNode } from 'react';
import { SyncDot } from './SyncDot';

/** The header every screen in the nav shares: title, optional subtitle, optional actions at the
 * far edge, and the quiet sync dot right beside the title — where a cook already looks, rather
 * than in a corner of the screen they have to learn about. */
export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="screen-header">
      <div>
        <div className="screen-title-row">
          <h1 className="screen-title">{title}</h1>
          <SyncDot />
        </div>
        {subtitle && <div className="muted screen-subtitle">{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}
