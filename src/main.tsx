import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'
import { CrashScreen } from './components/CrashScreen.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { installConsoleFallback, installErrorUx } from './lib/errorUx.ts'
import { captureBoundaryError, initSentry } from './lib/sentry.ts'

// Order matters: Sentry first, so the two installers below can see whether a client exists and
// pick exactly one reporting path between them (see errorUx.ts).
initSentry()
installErrorUx()
installConsoleFallback()

createRoot(document.getElementById('root')!, {
  // React 19 routes what used to reach `window.onerror` through these root options instead, so
  // an error thrown during render that no boundary catches would otherwise be invisible to
  // Sentry's globalHandlers integration. `onCaughtError` is intentionally left out: our own
  // boundaries already report what they catch, and wiring it too would double every report.
  onUncaughtError: (error) => {
    captureBoundaryError(error, 'root-uncaught')
  },
  onRecoverableError: (error) => {
    captureBoundaryError(error, 'root-recoverable')
  },
}).render(
  <StrictMode>
    {/* Inside StrictMode, not outside: the boundary is part of the app being double-rendered,
        not a wrapper around the checker. */}
    <ErrorBoundary boundary="root" fallback={(props) => <CrashScreen {...props} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
