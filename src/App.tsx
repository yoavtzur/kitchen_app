import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { AuthGate, MembershipGate, CookGate } from './components/Gate';
import { AppProvider } from './store/AppContext';
import { BottomNav } from './components/BottomNav';
import { SyncBadge } from './components/SyncBadge';
import { Home } from './screens/Home';
import { Recipes } from './screens/Recipes';
import { Consumption } from './screens/Consumption';
import { Tasks } from './screens/Tasks';
import { StockCount } from './screens/StockCount';
import { Orders } from './screens/Orders';
import { Settings } from './screens/Settings';
import { More } from './screens/More';

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <div className="app-shell">
          <main className="app-main">
            <AuthGate>
              <MembershipGate>
                <AppProvider>
                  <CookGate>
                    <SyncBadge />
                    <Routes>
                      <Route path="/" element={<Home />} />
                      <Route path="/ingredients" element={<Navigate to="/count" replace />} />
                      <Route path="/recipes" element={<Recipes />} />
                      <Route path="/consumption" element={<Consumption />} />
                      <Route path="/tasks" element={<Tasks />} />
                      <Route path="/count" element={<StockCount />} />
                      <Route path="/orders" element={<Orders />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/more" element={<More />} />
                    </Routes>
                    <BottomNav />
                  </CookGate>
                </AppProvider>
              </MembershipGate>
            </AuthGate>
          </main>
        </div>
      </AuthProvider>
    </HashRouter>
  );
}
