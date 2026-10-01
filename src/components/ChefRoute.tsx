import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../auth/usePermissions';

/** Route-level companion to hiding a tab: a cook who types `#/orders` lands back on the task
 * list instead of a screen that was removed from their nav. Client-side only — the server is
 * what actually refuses a cook's writes. */
export function ChefRoute({ children }: { children: ReactNode }) {
  const { isChef } = usePermissions();
  return isChef ? <>{children}</> : <Navigate to="/tasks" replace />;
}
