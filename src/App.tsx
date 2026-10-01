import { HashRouter, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AnalyticsContext } from './components/AnalyticsContext';
import { AuthGate, MaintenanceGate, MembershipGate, CookGate, NoticeGate } from './components/Gate';
import { AppProvider } from './store/AppContext';
import { BottomNav } from './components/BottomNav';
import { RouteBoundary } from './components/RouteBoundary';
import { SentryContext } from './components/SentryContext';
import { SyncBadge } from './components/SyncBadge';
import { UndoProvider } from './components/UndoProvider';
import { UpdatePrompt } from './components/UpdatePrompt';
import { APP_ROUTES, INVITE_ROUTES, LEGAL_ROUTES } from './routes';

/**
 * The gate stack, as a **pathless layout route**.
 *
 * `<Outlet />` sits exactly where `<Routes>` used to, which preserves the two properties the
 * old shape had: `BottomNav` and `SyncBadge` are still siblings of the thing that swaps per
 * route, so a route boundary can never take them down; and the whole stack — `AppProvider`
 * included — stays mounted across navigations instead of remounting per route, which is what a
 * per-route wrapper would have done.
 *
 * A layout route rather than a nested `<Routes>` because the legal pages have to be matched
 * *before* the gates render at all, and a descendant `<Routes>` is still rendered by its parent.
 */
function GatedApp() {
  return (
    <AuthGate>
      <MembershipGate>
        {/* Above AppProvider on purpose: during maintenance no sync store is ever constructed,
            so not one op can be dispatched. See MaintenanceGate. */}
        <MaintenanceGate>
          <AppProvider>
            <CookGate>
              <NoticeGate>
                {/* Above the Outlet and inside AppProvider: the "בטל" toast has to outlive the sheet
                    that triggered it, and it needs `dispatch` to undo. */}
                <UndoProvider>
                  <SentryContext />
                  <AnalyticsContext />
                  <SyncBadge />
                  <Outlet />
                  <BottomNav />
                </UndoProvider>
              </NoticeGate>
            </CookGate>
          </AppProvider>
        </MaintenanceGate>
      </MembershipGate>
    </AuthGate>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <div className="app-shell">
          {/* Outside every gate: a cook stuck behind a broken bundle on the sign-in screen is
              exactly who most needs to be offered the update. */}
          <UpdatePrompt />
          <main className="app-main">
            <Routes>
              {/* Declared above the layout route, so they never reach a gate. */}
              {[...LEGAL_ROUTES, ...INVITE_ROUTES].map(({ path, name, element }) => (
                <Route key={path} path={path} element={<RouteBoundary name={name}>{element}</RouteBoundary>} />
              ))}
              <Route element={<GatedApp />}>
                {APP_ROUTES.map(({ path, name, element, redirect }) => (
                  <Route
                    key={path}
                    path={path}
                    element={redirect ? element : <RouteBoundary name={name}>{element}</RouteBoundary>}
                  />
                ))}
              </Route>
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </HashRouter>
  );
}
