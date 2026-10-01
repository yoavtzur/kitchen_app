import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { usePermissions } from '../auth/usePermissions';
import { getDisplayTasks, taskProgress } from '../lib/tasks';
import { todayStr } from '../lib/date';
import { isTabActive, navTabsFor, type NavIconName } from '../lib/nav';
import { ConsumptionIcon, CountIcon, MenuIcon, OrdersIcon, RecipesIcon, TasksIcon } from './icons';

const ICONS: Record<NavIconName, () => React.ReactNode> = {
  tasks: () => <TasksIcon />,
  count: () => <CountIcon />,
  orders: () => <OrdersIcon />,
  consumption: () => <ConsumptionIcon />,
  recipes: () => <RecipesIcon />,
  menu: () => <MenuIcon />,
};

export function BottomNav() {
  const { state } = useApp();
  const { role } = usePermissions();
  const { pathname } = useLocation();
  // Both this and the Today screen count through getDisplayTasks -> taskProgress, so there is
  // no second counting rule to drift.
  //
  // Honest cost: this runs getDisplayTasks a second time per render. At this data size a memo
  // keyed on `state` is plenty; if it ever stops being enough, hoist one memoized call into
  // AppProvider — not before.
  const openCount = useMemo(() => taskProgress(getDisplayTasks(todayStr(), state)).open, [state]);

  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      {navTabsFor(role).map((tab) => {
        const count = tab.badge ? openCount : 0;
        const active = isTabActive(tab, pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={active ? 'active' : ''}
            aria-current={active ? 'page' : undefined}
            // A bare number read out on its own means nothing, so the count is folded into the
            // link's accessible name rather than left as a loose digit beside it.
            aria-label={count > 0 ? `${tab.label}, ${count} פתוחות` : undefined}
          >
            <span className="nav-icon-box">
              {ICONS[tab.icon]()}
              {count > 0 && (
                <span className="nav-badge" aria-hidden="true">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
