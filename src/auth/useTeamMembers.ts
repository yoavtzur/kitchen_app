import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { mapRpcError } from '../lib/rpcErrors';
import { useAuth } from './AuthContext';
import type { MemberRole } from '../types';

export type MemberRow = {
  userId: string;
  cookId: string | null;
  role: MemberRole;
  canEditRecipes: boolean;
  canDeleteRecipes: boolean;
};

/**
 * The restaurant's `memberships` rows — readable by every teammate under `memberships_read`.
 * Shared by the Team screen (the list itself) and Settings (account deletion needs to know whether
 * the caller is the last member), which used to carry two copies of the same fetch.
 *
 * A failed fetch is reported, not swallowed: an empty list on a dropped connection is visually
 * identical to "you are the only member", and a chef would act on that. `cancelledRef` covers the
 * other half — a slow response landing after the screen is gone.
 */
export function useTeamMembers() {
  const { membership } = useAuth();
  const enabled = isSupabaseConfigured && Boolean(membership);
  const [members, setMembers] = useState<MemberRow[]>([]);
  // Who owns the restaurant (migration 0011). `undefined` = not known: the column is missing (0011
  // not applied yet) or the read failed. The UI then falls back to the old rule, every chef equal —
  // the server is what enforces either way.
  const [ownerId, setOwnerId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  // Derived on the first render rather than announced from the effect: in remote mode the first
  // paint genuinely is loading.
  const [loading, setLoading] = useState(enabled);
  const cancelledRef = useRef(false);
  const restaurantId = membership?.restaurantId;

  const reload = useCallback(() => {
    if (!isSupabaseConfigured || !supabase || !restaurantId) return;
    supabase
      .from('restaurants')
      .select('owner_id')
      .eq('id', restaurantId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelledRef.current) return;
        setOwnerId(err || !data ? undefined : ((data.owner_id as string | null) ?? null));
      });
    supabase
      .from('memberships')
      .select('user_id, cook_id, role, can_edit_recipes, can_delete_recipes')
      .eq('restaurant_id', restaurantId)
      .then(({ data, error: err }) => {
        if (cancelledRef.current) return;
        setLoading(false);
        if (err) {
          setError(mapRpcError(err));
          return;
        }
        setError('');
        setMembers(
          (data ?? []).map((row) => ({
            userId: row.user_id as string,
            cookId: row.cook_id as string | null,
            role: row.role as MemberRole,
            canEditRecipes: Boolean(row.can_edit_recipes),
            canDeleteRecipes: Boolean(row.can_delete_recipes),
          })),
        );
      });
  }, [restaurantId]);

  useEffect(() => {
    cancelledRef.current = false;
    reload();
    return () => {
      cancelledRef.current = true;
    };
  }, [reload]);

  const retry = useCallback(() => {
    setError('');
    setLoading(true);
    reload();
  }, [reload]);

  return { members, ownerId, loading, error, reload, retry, enabled };
}
