import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Rubik, self-hosted, replacing the three Google Fonts <link> tags index.html used to carry.
// That fixes four things at once: two render-blocking cross-origin round trips on first paint,
// a font that simply never arrived offline, an EU visitor's IP being handed to Google on every
// load (which is what would have required a cookie/consent banner), and a CSP that would
// otherwise have to allow fonts.googleapis.com and fonts.gstatic.com.
//
// Exactly the four weights this app uses — 400 for body, 600 and 700 throughout, 900 for
// .stat-card .stat-value — in the two subsets it needs. Hebrew for all the text, Latin for
// every digit, which is why Latin can't be dropped from a Hebrew-only app. index.html used to
// request six weights across every subset Rubik ships.
import '@fontsource/rubik/hebrew-400.css'
import '@fontsource/rubik/hebrew-600.css'
import '@fontsource/rubik/hebrew-700.css'
import '@fontsource/rubik/hebrew-900.css'
import '@fontsource/rubik/latin-400.css'
import '@fontsource/rubik/latin-600.css'
import '@fontsource/rubik/latin-700.css'
import '@fontsource/rubik/latin-900.css'
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
