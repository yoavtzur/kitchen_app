import { Navigate } from 'react-router-dom';
import { Home } from './screens/Home';
import { MorningDashboard } from './screens/MorningDashboard';
import { Recipes } from './screens/Recipes';
import { Consumption } from './screens/Consumption';
import { Tasks } from './screens/Tasks';
import { StockCount } from './screens/StockCount';
import { Orders } from './screens/Orders';
import { Settings } from './screens/Settings';
import { More } from './screens/More';
import { NotFound } from './screens/NotFound';

export type AppRoute = {
  path: string;
  /** Stable identifier for this route, independent of its path. Used as the Sentry `boundary`
   * tag, so a report says "orders crashed" rather than "/orders crashed" even after a path
   * changes. */
  name: string;
  element: React.ReactNode;
  /** A pure redirect: no boundary and (from Phase 3) no Suspense wrapper is worth spending on
   * something that renders nothing and can't throw. */
  redirect?: boolean;
};

/**
 * The route table, as data.
 *
 * Pulled out of `App.tsx` so that everything which has to happen *per route* — the error
 * boundary here, lazy-loading `Suspense` in Phase 3 — is expressed exactly once, in the single
 * `.map()` that consumes this, instead of being repeated across ten hand-written `<Route>`
 * elements where the eleventh will inevitably be added without it.
 */
export const APP_ROUTES: AppRoute[] = [
  { path: '/', name: 'home', element: <Home /> },
  { path: '/morning', name: 'morning', element: <MorningDashboard /> },
  { path: '/ingredients', name: 'ingredients-redirect', element: <Navigate to="/count" replace />, redirect: true },
  { path: '/recipes', name: 'recipes', element: <Recipes /> },
  { path: '/consumption', name: 'consumption', element: <Consumption /> },
  { path: '/tasks', name: 'tasks', element: <Tasks /> },
  { path: '/count', name: 'count', element: <StockCount /> },
  { path: '/orders', name: 'orders', element: <Orders /> },
  { path: '/settings', name: 'settings', element: <Settings /> },
  { path: '/more', name: 'more', element: <More /> },
  // Without this, an unmatched hash rendered nothing at all: chrome, no content, no explanation.
  { path: '*', name: 'not-found', element: <NotFound /> },
];
