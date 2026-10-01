import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { track } from '../lib/analytics';
import { APP_ROUTES } from '../routes';

/**
 * Reports which screen is showing. Renders nothing; a sibling of `SentryContext` for the same
 * reason (the shallowest place that sees routing).
 *
 * The screen is the route's **name** from the route table, looked up by matching the pathname —
 * never the pathname itself. Today the two are interchangeable, but a pathname is a thing a
 * future route can put an id or a search term into, and a name cannot. Redirects are skipped (the
 * screen they land on reports itself) and an unmatched path reports as `not-found` rather than
 * as whatever was typed.
 */
export function AnalyticsContext() {
  const { pathname } = useLocation();

  useEffect(() => {
    const route = APP_ROUTES.find((r) => !r.redirect && r.path !== '*' && matchPath(r.path, pathname));
    track({ name: 'screen_viewed', screen: route?.name ?? 'not-found' });
  }, [pathname]);

  return null;
}
