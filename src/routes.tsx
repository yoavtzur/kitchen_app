// oxlint-disable react/only-export-components -- the `lazy()` bindings below read as component
// declarations to the linter, but this file exports only the route table; the screens
// themselves live in src/screens/ and are what Fast Refresh actually tracks.
import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { ChefRoute } from './components/ChefRoute';
import { Today } from './screens/Today';

// Every screen except the landing one is lazy. `Today` stays eager on purpose: it is the PWA's
// start_url and the target of the '/' redirect, so lazy-loading it would only add a chunk round
// trip to the one path that is always on the critical rendering path.
//
// `Suspense` and the error boundary both live in the single wrapper in App.tsx that consumes
// this table, so adding a screen here cannot forget either.
const Recipes = lazy(() => import('./screens/Recipes').then((m) => ({ default: m.Recipes })));
const Consumption = lazy(() => import('./screens/Consumption').then((m) => ({ default: m.Consumption })));
const StockCount = lazy(() => import('./screens/StockCount').then((m) => ({ default: m.StockCount })));
const Orders = lazy(() => import('./screens/Orders').then((m) => ({ default: m.Orders })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const Team = lazy(() => import('./screens/Team').then((m) => ({ default: m.Team })));
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })));
const Menu = lazy(() => import('./screens/Menu').then((m) => ({ default: m.Menu })));
const Stations = lazy(() => import('./screens/Stations').then((m) => ({ default: m.Stations })));
const NotFound = lazy(() => import('./screens/NotFound').then((m) => ({ default: m.NotFound })));
const JoinRoute = lazy(() => import('./screens/JoinRoute').then((m) => ({ default: m.JoinRoute })));
const Privacy = lazy(() => import('./screens/Legal').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./screens/Legal').then((m) => ({ default: m.Terms })));

/**
 * Fetches every lazy screen's chunk once the app is up and the browser is idle.
 *
 * Lazy loading keeps the first paint small, but on its own it makes the *first* visit to each
 * screen pay a chunk round trip at the moment of the tap — a visible pause (and a skeleton) on
 * exactly the navigation the cook is waiting on. Warming them while idle moves that cost to a
 * time nobody is looking. `import()` of an already-loaded module is free, so this changes nothing
 * about what `lazy()` does later; it only has the chunk ready. The service worker precaches the
 * same files, so after the first launch this is a cache read, not a download.
 */
export function preloadScreens(): void {
  const run = () => {
    void import('./screens/Menu');
    void import('./screens/StockCount');
    void import('./screens/Recipes');
    void import('./screens/Orders');
    void import('./screens/Consumption');
    void import('./screens/Settings');
    void import('./screens/Team');
    void import('./screens/Profile');
    void import('./screens/Stations');
  };
  if (typeof window === 'undefined') return;
  const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle.call(window, run);
  else window.setTimeout(run, 2000);
}

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
  // The morning order is the first segment of the Orders screen now, not a screen of its own.
  { path: '/morning', name: 'morning-redirect', element: <Navigate to="/orders" replace />, redirect: true },
  { path: '/ingredients', name: 'ingredients-redirect', element: <Navigate to="/count" replace />, redirect: true },
  { path: '/recipes', name: 'recipes', element: <Recipes /> },
  { path: '/consumption', name: 'consumption', element: <ChefRoute><Consumption /></ChefRoute> },
  { path: '/tasks', name: 'tasks', element: <Today /> },
  { path: '/count', name: 'count', element: <StockCount /> },
  { path: '/orders', name: 'orders', element: <ChefRoute><Orders /></ChefRoute> },
  { path: '/stations', name: 'stations', element: <ChefRoute><Stations /></ChefRoute> },
  { path: '/settings', name: 'settings', element: <Settings /> },
  { path: '/menu', name: 'menu', element: <Menu /> },
  { path: '/team', name: 'team', element: <Team /> },
  { path: '/profile', name: 'profile', element: <Profile /> },
  { path: '/more', name: 'more-redirect', element: <Navigate to="/menu" replace />, redirect: true },
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

/**
 * An invitation link (`#/join/<token>`), also **outside every gate**: whoever opens it has no
 * account yet. It banks the token and redirects to `/`, where the gates take over — see JoinRoute.
 */
export const INVITE_ROUTES: AppRoute[] = [
  { path: '/join/:token', name: 'join-invite', element: <JoinRoute /> },
];
