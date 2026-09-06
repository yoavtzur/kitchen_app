-- Fixes a real bug found during verification: this function's own `returns table
-- (restaurant_id, ...)` declares restaurant_id as an OUT parameter, and a bare column-list
-- ON CONFLICT target is ambiguous between that variable and the table's column of the same
-- name (raises 42702 "column reference is ambiguous" — only at call time, not at CREATE
-- FUNCTION time, which is why the earlier migration appeared to apply cleanly).
create or replace function public.join_restaurant(p_code text)
returns table (restaurant_id uuid, name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select r.id, r.name into v_id, v_name
    from public.restaurants r where r.join_code = upper(btrim(p_code));
  if v_id is null then raise exception 'invalid_code' using errcode = 'P0002'; end if;
  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_uid, 'member')
  on conflict on constraint memberships_pkey do nothing;  -- unique(user_id) still blocks a 2nd restaurant
  return query select v_id, v_name;
end $$;
