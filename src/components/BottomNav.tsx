import { NavLink } from 'react-router-dom';

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function HomeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h5v-5h2v5h5v-9" />
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

function ConsumptionIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
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

const ITEMS = [
  { to: '/', Icon: HomeIcon, label: 'בית', end: true },
  { to: '/tasks', Icon: TasksIcon, label: 'משימות' },
  { to: '/count', Icon: IngredientsIcon, label: 'מצרכים' },
  { to: '/recipes', Icon: RecipesIcon, label: 'מתכונים' },
  { to: '/consumption', Icon: ConsumptionIcon, label: 'צריכה' },
  { to: '/more', Icon: MoreIcon, label: 'עוד' },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {ITEMS.map(({ to, Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => (isActive ? 'active' : '')}
        >
          <span className="nav-icon-box">
            <Icon />
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
