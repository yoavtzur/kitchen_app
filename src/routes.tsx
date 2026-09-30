// oxlint-disable react/only-export-components -- the `lazy()` bindings below read as component
// declarations to the linter, but this file exports only the route table; the screens
// themselves live in src/screens/ and are what Fast Refresh actually tracks.
import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { Home } from './screens/Home';

// Every screen except the landing one is lazy. The landing screen stays eager on purpose: it is
// the PWA's start_url, so lazy-loading it would only add a chunk round trip to the one path
// that is always on the critical rendering path.
//
// `Suspense` and the error boundary both live in the single wrapper in App.tsx that consumes
// this table, so adding a screen here cannot forget either.
const MorningDashboard = lazy(() => import('./screens/MorningDashboard').then((m) => ({ default: m.MorningDashboard })));
const Recipes = lazy(() => import('./screens/Recipes').then((m) => ({ default: m.Recipes })));
const Consumption = lazy(() => import('./screens/Consumption').then((m) => ({ default: m.Consumption })));
const Tasks = lazy(() => import('./screens/Tasks').then((m) => ({ default: m.Tasks })));
const StockCount = lazy(() => import('./screens/StockCount').then((m) => ({ default: m.StockCount })));
const Orders = lazy(() => import('./screens/Orders').then((m) => ({ default: m.Orders })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const More = lazy(() => import('./screens/More').then((m) => ({ default: m.More })));
const NotFound = lazy(() => import('./screens/NotFound').then((m) => ({ default: m.NotFound })));

export type AppRoute = {
  path: string;
  /** Stable identifier for this route, independent of its path. Used as the Sentry `boundary`
   * tag, so a report says "orders crashed" rather than "/orders crashed" even after a path
   * changes. */
  name: string;
  element: React.ReactNode;
  /** A pure redirect: no boundary and no Suspense wrapper is worth spending on something that
   * renders nothing and can't throw. */
  redirect?: boolean;
};

/**
 * The route table, as data.
 *
 * Pulled out of `App.tsx` so that everything which has to happen *per route* — the error
 * boundary, the Suspense fallback — is expressed exactly once, in the single `.map()` that
 * consumes this, instead of being repeated across ten hand-written `<Route>` elements where the
 * eleventh will inevitably be added without it.
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
