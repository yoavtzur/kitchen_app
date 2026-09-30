import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { getDisplayTasks, taskProgress } from '../lib/tasks';
import { todayStr } from '../lib/date';

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function OrdersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 6h2l1.6 9.2a2 2 0 0 0 2 1.7h7.2a2 2 0 0 0 2-1.6L20 9H7" />
      <circle cx="10" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="20" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.3 12.3l2.4 2.4 5-5" />
    </svg>
  );
}

function IngredientsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 9h16l-1.5 9.2a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 9z" />
      <path d="M8.5 9 10 4M15.5 9 14 4" />
    </svg>
  );
}

function RecipesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 5.2a2 2 0 0 1 2-2h6v17.6H6a2 2 0 0 1-2-2V5.2z" />
      <path d="M20 5.2a2 2 0 0 0-2-2h-6v17.6h6a2 2 0 0 0 2-2V5.2z" />
    </svg>
  );
}

function MorningIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 18h18" />
      <path d="M6 18a6 6 0 0 1 12 0" />
      <path d="M12 4v3M4.5 8.5l2 2M19.5 8.5l-2 2" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

// The "בית" slot is gone with Home itself — '/' now redirects to '/tasks', so a separate entry
// for it would be a second button leading to the same screen. Orders takes the freed slot,
// which is what a cook reaches for most often after the ones already here.
const ITEMS = [
  { to: '/tasks', Icon: TasksIcon, label: 'משימות', badge: true },
  { to: '/count', Icon: IngredientsIcon, label: 'מצרכים' },
  { to: '/morning', Icon: MorningIcon, label: 'בוקר' },
  { to: '/recipes', Icon: RecipesIcon, label: 'מתכונים' },
  { to: '/orders', Icon: OrdersIcon, label: 'הזמנות' },
  { to: '/more', Icon: MoreIcon, label: 'עוד' },
];

export function BottomNav() {
  const { state } = useApp();
  // Both this and the Today screen count through getDisplayTasks -> taskProgress, so there is
  // no second counting rule to drift.
  //
  // Honest cost: this runs getDisplayTasks a second time per render. At this data size a memo
  // keyed on `state` is plenty; if it ever stops being enough, hoist one memoized call into
  // AppProvider — not before.
  const openCount = useMemo(() => taskProgress(getDisplayTasks(todayStr(), state)).open, [state]);

  return (
    <nav className="bottom-nav" aria-label="ניווט ראשי">
      {ITEMS.map(({ to, Icon, label, badge }) => {
        const count = badge ? openCount : 0;
        return (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => (isActive ? 'active' : '')}
            // A bare number read out on its own means nothing, so the count is folded into the
            // link's accessible name rather than left as a loose digit beside it.
            aria-label={count > 0 ? `${label}, ${count} פתוחות` : undefined}
          >
            <span className="nav-icon-box">
              <Icon />
              {count > 0 && (
                <span className="nav-badge" aria-hidden="true">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </span>
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
