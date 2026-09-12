-- Lets a chef remove a teammate's access to the restaurant. No foreign-key/table work needed:
-- `memberships` already cascades from `auth.users`, and `ops.user_id` references `auth.users`
-- rather than `memberships`, so deleting a membership row can't touch any stored op or task —
-- both live inside the restaurant's own `snapshots.state` jsonb blob, untouched by this RPC.
-- Client-side cleanup of that removed cook's open task/override assignments happens via the
-- ordinary REMOVE_COOK reducer op, appended like any other change.

create or replace function public.remove_member(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_restaurant_id uuid;
  v_caller_role text;
begin
  select m.restaurant_id, m.role into v_restaurant_id, v_caller_role
    from public.memberships m where m.user_id = v_caller;

  if v_caller_role is distinct from 'chef' then
    raise exception 'forbidden_action' using errcode = '42501';
  end if;

  if p_user_id = v_caller then
    raise exception 'cannot_remove_self' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id and m.user_id = p_user_id
  ) then
    raise exception 'no_such_member' using errcode = 'P0002';
  end if;

  delete from public.memberships where restaurant_id = v_restaurant_id and user_id = p_user_id;
end $$;

grant execute on function public.remove_member(uuid) to authenticated;
