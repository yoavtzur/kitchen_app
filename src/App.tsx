import { HashRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AuthGate, MaintenanceGate, MembershipGate, CookGate } from './components/Gate';
import { AppProvider } from './store/AppContext';
import { BottomNav } from './components/BottomNav';
import { RouteBoundary } from './components/RouteBoundary';
import { SentryContext } from './components/SentryContext';
import { SyncBadge } from './components/SyncBadge';
import { UpdatePrompt } from './components/UpdatePrompt';
import { APP_ROUTES } from './routes';

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <div className="app-shell">
          {/* Outside every gate: a cook stuck behind a broken bundle on the sign-in screen is
              exactly who most needs to be offered the update. */}
          <UpdatePrompt />
          <main className="app-main">
            <AuthGate>
              <MembershipGate>
                {/* Above AppProvider on purpose: during maintenance no sync store is ever
                    constructed, so not one op can be dispatched. See MaintenanceGate. */}
                <MaintenanceGate>
                  <AppProvider>
                    <CookGate>
                      <SentryContext />
                      <SyncBadge />
                      {/* BottomNav and SyncBadge are siblings of <Routes>, so a per-route
                          boundary (which lives inside each element) can never take them down
                          with it. */}
                      <Routes>
                        {APP_ROUTES.map(({ path, name, element, redirect }) => (
                          <Route
                            key={path}
                            path={path}
                            element={redirect ? element : <RouteBoundary name={name}>{element}</RouteBoundary>}
                          />
                        ))}
                      </Routes>
                      <BottomNav />
                    </CookGate>
                  </AppProvider>
                </MaintenanceGate>
              </MembershipGate>
            </AuthGate>
          </main>
        </div>
      </AuthProvider>
    </HashRouter>
  );
}
