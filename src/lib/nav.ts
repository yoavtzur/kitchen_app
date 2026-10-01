import type { MemberRole } from '../types';

/**
 * Which bottom-nav tabs each role sees.
 *
 * Pure and free of React on purpose: this is the one place that decides what a cook is shown,
 * and under this repo's no-jsdom rule the only way to test that is as a function. The component
 * keeps nothing but the icons. Which *routes* a cook may open is `ChefRoute` in routes.tsx.
 *
 * This is presentation, not security. The real boundary is `append_ops` on the server (see
 * supabase/migrations/0003_rls_and_granular_roles.sql); hiding a tab only keeps a cook from
 * stumbling into screens that are noise for them.
 */

export type NavIconName = 'tasks' | 'count' | 'orders' | 'consumption' | 'recipes' | 'menu';

export type NavTab = {
  to: string;
  label: string;
  icon: NavIconName;
  /** Shows the open-task count. Only the tasks tab carries one. */
  badge?: boolean;
  /** Extra path prefixes that keep this tab lit — so the "תפריט" tab stays active on the screens
   * it opens (settings, stations), instead of the nav going dark on a sub-screen. */
  alsoActiveOn?: string[];
};

const TASKS: NavTab = { to: '/tasks', label: 'משימות', icon: 'tasks', badge: true };
const COUNT: NavTab = { to: '/count', label: 'מלאי', icon: 'count' };

const CHEF_TABS: NavTab[] = [
  TASKS,
  COUNT,
  { to: '/orders', label: 'הזמנות', icon: 'orders', alsoActiveOn: ['/morning'] },
  { to: '/consumption', label: 'צריכה', icon: 'consumption' },
  { to: '/menu', label: 'תפריט', icon: 'menu', alsoActiveOn: ['/recipes', '/settings', '/stations', '/team', '/profile', '/receiving'] },
];

// A cook gets the menu tab too, deliberately: sign-out and account deletion live behind it, and
// the privacy notice (migration 0007) makes erasure something every account holder must be able
// to reach — not only the chef.
const COOK_TABS: NavTab[] = [
  TASKS,
  { to: '/recipes', label: 'מתכונים', icon: 'recipes' },
  COUNT,
  { to: '/menu', label: 'תפריט', icon: 'menu', alsoActiveOn: ['/settings', '/team', '/profile'] },
];

export function navTabsFor(role: MemberRole): NavTab[] {
  return role === 'chef' ? CHEF_TABS : COOK_TABS;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isTabActive(tab: NavTab, pathname: string): boolean {
  return [tab.to, ...(tab.alsoActiveOn ?? [])].some((p) => matchesPrefix(pathname, p));
}
