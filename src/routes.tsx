// oxlint-disable react/only-export-components -- the `lazy()` bindings below read as component
// declarations to the linter, but this file exports only the route table; the screens
// themselves live in src/screens/ and are what Fast Refresh actually tracks.
import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { Today } from './screens/Today';

// Every screen except the landing one is lazy. `Today` stays eager on purpose: it is the PWA's
// start_url and the target of the '/' redirect, so lazy-loading it would only add a chunk round
// trip to the one path that is always on the critical rendering path.
//
// `Suspense` and the error boundary both live in the single wrapper in App.tsx that consumes
// this table, so adding a screen here cannot forget either.
const MorningDashboard = lazy(() => import('./screens/MorningDashboard').then((m) => ({ default: m.MorningDashboard })));
const Recipes = lazy(() => import('./screens/Recipes').then((m) => ({ default: m.Recipes })));
const Consumption = lazy(() => import('./screens/Consumption').then((m) => ({ default: m.Consumption })));
const StockCount = lazy(() => import('./screens/StockCount').then((m) => ({ default: m.StockCount })));
const Orders = lazy(() => import('./screens/Orders').then((m) => ({ default: m.Orders })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const More = lazy(() => import('./screens/More').then((m) => ({ default: m.More })));
const NotFound = lazy(() => import('./screens/NotFound').then((m) => ({ default: m.NotFound })));
const Privacy = lazy(() => import('./screens/Legal').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./screens/Legal').then((m) => ({ default: m.Terms })));

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
  // '/tasks' is canonical and '/' redirects to it, the same pattern '/ingredients' already
  // uses. This also removes a footgun: `NavLink to="/" end` needed that `end` prop precisely
  // because '/' prefixes every other path.
  { path: '/', name: 'home-redirect', element: <Navigate to="/tasks" replace />, redirect: true },
  { path: '/morning', name: 'morning', element: <MorningDashboard /> },
  { path: '/ingredients', name: 'ingredients-redirect', element: <Navigate to="/count" replace />, redirect: true },
  { path: '/recipes', name: 'recipes', element: <Recipes /> },
  { path: '/consumption', name: 'consumption', element: <Consumption /> },
  { path: '/tasks', name: 'tasks', element: <Today /> },
  { path: '/count', name: 'count', element: <StockCount /> },
  { path: '/orders', name: 'orders', element: <Orders /> },
  { path: '/settings', name: 'settings', element: <Settings /> },
  { path: '/more', name: 'more', element: <More /> },
  // Without this, an unmatched hash rendered nothing at all: chrome, no content, no explanation.
  { path: '*', name: 'not-found', element: <NotFound /> },
];

/**
 * The two routes that render **outside every gate** — no session, no membership, no sync store.
 *
 * Kept as a separate table rather than a flag on `AppRoute` because the difference is not a
 * property of the route, it is which `<Route>` parent it is declared under: `App.tsx` lists
 * these directly and puts everything in `APP_ROUTES` under a pathless layout route that holds
 * the gates. A flag would have to be read at render time by something that cannot act on it.
 *
 * They must be reachable before sign-up, which is the entire point: a privacy notice a person
 * can only read after creating the account is given after the processing it describes began.
 * `Auth.tsx` and `Onboarding.tsx` link here.
 */
export const LEGAL_ROUTES: AppRoute[] = [
  { path: '/legal/privacy', name: 'privacy', element: <Privacy /> },
  { path: '/legal/terms', name: 'terms', element: <Terms /> },
];
