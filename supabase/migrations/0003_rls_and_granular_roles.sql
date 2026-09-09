-- Granular ABAC for recipe editing/deleting, plus a role-vocabulary migration (owner/member ->
-- chef/cook). Idempotent: every statement uses `if not exists` / `create or replace` / a `DO`
-- block guard, so re-running this file on an already-migrated project is a no-op.
--
-- Why RLS itself stays untouched: `memberships`, `ops`, `snapshots` and `restaurants` still have
-- SELECT-only policies (see 0001_init.sql) and no table-level write grants. There is no
-- `recipes` table — every recipe lives inside `snapshots.state`, a single jsonb blob folded
-- forward by the `ops` log. A row-level policy cannot express "this cook may edit recipes but
-- not delete them" over a single jsonb column shared by the whole restaurant's data, and adding
-- write policies to these tables would only weaken the existing "every write goes through a
-- SECURITY DEFINER RPC" model for no gain. So permission enforcement lives inside `append_ops`
-- itself — the one chokepoint every write (recipe or otherwise) already passes through. That is
-- genuine server-side enforcement: a client cannot bypass it by calling PostgREST directly, the
-- same way it already can't bypass seq allocation or membership checks today.
--
-- Permission matrix:
--   chef  — everything a cook can do, plus editing recipes, deleting recipes, and managing
--           teammates' permissions (set_member_permissions), and resetting the snapshot
--           (reset_snapshot, since it deletes the whole op log).
--   cook  — everything except the three chef-only actions above. `can_edit_recipes` /
--           `can_delete_recipes` grant a cook those two abilities individually without making
--           them a chef (so they still can't manage teammates or reset the snapshot).

-- ── memberships: new columns + role vocabulary ───────────────────────────────

alter table public.memberships
  add column if not exists can_edit_recipes   boolean not null default false,
  add column if not exists can_delete_recipes boolean not null default false;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'memberships_role_check'
  ) then
    alter table public.memberships drop constraint memberships_role_check;
  end if;
end $$;

update public.memberships set role = 'chef' where role = 'owner';
update public.memberships set role = 'cook' where role = 'member';

alter table public.memberships alter column role set default 'cook';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'memberships_role_check'
  ) then
    alter table public.memberships
      add constraint memberships_role_check check (role in ('chef', 'cook'));
  end if;
end $$;

-- ── create_restaurant / join_restaurant: new vocabulary ──────────────────────

create or replace function public.create_restaurant(
  p_name text, p_snapshot jsonb, p_schema_version int
) returns table (restaurant_id uuid, join_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_code text; v_uid uuid := auth.uid(); v_try int := 0;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where user_id = v_uid) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  loop
    v_try := v_try + 1;
    v_code := public.gen_join_code();
    begin
      insert into public.restaurants (name, join_code, schema_version, created_by)
      values (btrim(p_name), v_code, p_schema_version, v_uid)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try > 10 then raise; end if;
    end;
  end loop;
  insert into public.snapshots (restaurant_id, seq, state) values (v_id, 0, p_snapshot);
  insert into public.memberships (restaurant_id, user_id, role) values (v_id, v_uid, 'chef');
  return query select v_id, v_code;
end $$;

create or replace function public.join_restaurant(p_code text)
returns table (restaurant_id uuid, name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select r.id, r.name into v_id, v_name
    from public.restaurants r where r.join_code = upper(btrim(p_code));
  if v_id is null then raise exception 'invalid_code' using errcode = 'P0002'; end if;
  -- Named-constraint form, not `on conflict (restaurant_id, user_id)`: this function's own
  -- `returns table (restaurant_id, ...)` declares restaurant_id as an OUT parameter, and a bare
  -- column-list conflict target is ambiguous against it (42702) — see 0002_fix_join_restaurant.sql.
  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_uid, 'cook')
  on conflict on constraint memberships_pkey do nothing;
  return query select v_id, v_name;
end $$;

-- ── permission mapping ────────────────────────────────────────────────────────

-- Maps an op's action to the permission flag it requires, or null when the action is
-- unrestricted (open to any member — this is what keeps the sync engine working unchanged for
-- every action type except the handful listed here).
create or replace function public.action_requires(p_action jsonb) returns text
language sql immutable as $$
  select case p_action ->> 'type'
    when 'ADD_RECIPE'    then 'edit_recipes'
    when 'UPDATE_RECIPE' then 'edit_recipes'
    when 'SAVE_PREP_ITEM' then 'edit_recipes'
    when 'DELETE_RECIPE'  then 'delete_recipes'
    -- pruneEntities (src/lib/integrity.ts) deletes a product's linked recipe along with it, so
    -- deleting a prep item from the product side needs the same permission as deleting it from
    -- the recipe side.
    when 'DELETE_PRODUCT' then 'delete_recipes'
    else null
  end;
$$;

-- ── append_ops: enforce permissions before allocating any seq ────────────────

create or replace function public.append_ops(
  p_restaurant_id uuid, p_client_id text, p_ops jsonb  -- [{op_id, action}, …] in causal order
) returns table (seq bigint, op_id uuid, action jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_last bigint;
  v_uid uuid := auth.uid();
  v_n int;
  v_role text;
  v_can_edit boolean;
  v_can_delete boolean;
  v_required text;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  v_n := coalesce(jsonb_array_length(p_ops), 0);
  if v_n = 0   then return; end if;
  if v_n > 200 then raise exception 'batch_too_large'; end if;

  select m.role, m.can_edit_recipes, m.can_delete_recipes
    into v_role, v_can_edit, v_can_delete
    from public.memberships m
   where m.restaurant_id = p_restaurant_id and m.user_id = v_uid;

  -- Chefs pass everything; a cook needs the matching flag. Scanned before the row lock below, so
  -- a rejected batch never touches last_seq.
  if v_role <> 'chef' then
    for v_required in
      select distinct public.action_requires(e -> 'action')
        from jsonb_array_elements(p_ops) as e
       where public.action_requires(e -> 'action') is not null
    loop
      if v_required = 'edit_recipes' and not v_can_edit then
        raise exception 'forbidden_action' using errcode = '42501';
      end if;
      if v_required = 'delete_recipes' and not v_can_delete then
        raise exception 'forbidden_action' using errcode = '42501';
      end if;
    end loop;
  end if;

  -- Serializes concurrent writers for this restaurant.
  select r.last_seq into v_last from public.restaurants r
   where r.id = p_restaurant_id for update;
  if not found then raise exception 'no_such_restaurant' using errcode = 'P0002'; end if;

  return query
  with incoming as (
    select (e ->> 'op_id')::uuid as op_id, e -> 'action' as action, ord
      from jsonb_array_elements(p_ops) with ordinality as t(e, ord)
  ), fresh as (
    select i.op_id, i.action, row_number() over (order by i.ord) as rn
      from incoming i
     where not exists (select 1 from public.ops o
                        where o.restaurant_id = p_restaurant_id and o.op_id = i.op_id)
  ), ins as (
    insert into public.ops (restaurant_id, seq, op_id, client_id, user_id, action)
    select p_restaurant_id, v_last + f.rn, f.op_id, p_client_id, v_uid, f.action from fresh f
    returning ops.seq, ops.op_id, ops.action, ops.created_at
  ), bump as (
    update public.restaurants
       set last_seq = v_last + (select count(*) from fresh)
     where id = p_restaurant_id
  )
  select * from ins order by ins.seq;
end $$;

-- ── reset_snapshot: chef-only (deletes the whole op log) ──────────────────────

create or replace function public.reset_snapshot(
  p_restaurant_id uuid, p_snapshot jsonb, p_schema_version int
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last bigint; v_new bigint; v_role text;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  select m.role into v_role from public.memberships m
   where m.restaurant_id = p_restaurant_id and m.user_id = auth.uid();
  if v_role <> 'chef' then
    raise exception 'forbidden_action' using errcode = '42501';
  end if;
  select r.last_seq into v_last from public.restaurants r where r.id = p_restaurant_id for update;
  v_new := v_last + 1000;
  delete from public.ops where restaurant_id = p_restaurant_id;
  insert into public.snapshots (restaurant_id, seq, state, updated_at)
  values (p_restaurant_id, v_new, p_snapshot, now())
  on conflict (restaurant_id) do update
    set seq = excluded.seq, state = excluded.state, updated_at = now();
  update public.restaurants
     set last_seq = v_new, snapshot_seq = v_new, schema_version = p_schema_version
   where id = p_restaurant_id;
  return v_new;
end $$;

-- compact_snapshot is deliberately left open to any member: it's a maintenance no-op (shrinks
-- the ops table, guarded by snapshot_seq), not a data change, so it needs no permission check.

-- ── set_member_permissions: chef manages teammates' flags ────────────────────

create or replace function public.set_member_permissions(
  p_user_id uuid, p_role text, p_can_edit_recipes boolean, p_can_delete_recipes boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_restaurant_id uuid;
  v_caller_role text;
  v_chef_count int;
begin
  select m.restaurant_id, m.role into v_restaurant_id, v_caller_role
    from public.memberships m where m.user_id = v_caller;
  if v_caller_role <> 'chef' then
    raise exception 'forbidden_action' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id and m.user_id = p_user_id
  ) then
    raise exception 'no_such_member' using errcode = 'P0002';
  end if;
  if p_role not in ('chef', 'cook') then
    raise exception 'invalid_role';
  end if;

  -- The last remaining chef cannot demote themselves — there would be nobody left who could
  -- undo it or manage permissions at all.
  if p_user_id = v_caller and p_role <> 'chef' then
    select count(*) into v_chef_count from public.memberships m
     where m.restaurant_id = v_restaurant_id and m.role = 'chef';
    if v_chef_count <= 1 then
      raise exception 'last_chef' using errcode = '42501';
    end if;
  end if;

  update public.memberships
     set role = p_role, can_edit_recipes = p_can_edit_recipes, can_delete_recipes = p_can_delete_recipes
   where restaurant_id = v_restaurant_id and user_id = p_user_id;
end $$;

grant execute on function public.set_member_permissions(uuid, text, boolean, boolean) to authenticated;
