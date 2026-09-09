import { useAuth } from './AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import type { MemberRole } from '../types';

export type Permissions = {
  role: MemberRole;
  isChef: boolean;
  canEditRecipes: boolean;
  canDeleteRecipes: boolean;
};

/** Calls useAuth() unconditionally, then branches on isSupabaseConfigured after the hook call —
 * matching the convention in components/Gate.tsx, so hook order never depends on config. In
 * local mode there's no server-authoritative membership, so a single-device user is treated as
 * their own chef: full permissions, nothing to gate. */
export function usePermissions(): Permissions {
  const { membership } = useAuth();
  if (!isSupabaseConfigured || !membership) {
    return { role: 'chef', isChef: true, canEditRecipes: true, canDeleteRecipes: true };
  }
  return {
    role: membership.role,
    isChef: membership.role === 'chef',
    canEditRecipes: membership.role === 'chef' || membership.canEditRecipes,
    canDeleteRecipes: membership.role === 'chef' || membership.canDeleteRecipes,
  };
}
