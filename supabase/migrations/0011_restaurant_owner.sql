-- 0011 — more than one chef, and one owner.
--
-- A kitchen could always have several chefs: `set_member_permissions` (0003) accepted role 'chef'
-- from any chef. What it could not say is who is in charge of the chefs, so any chef could demote or
-- remove any other — including the person who opened the restaurant. This adds an owner:
--
--   • `restaurants.owner_id` — who opened the restaurant, unless ownership was handed on.
--   • Promoting a cook to chef, demoting a chef, and removing a chef: **owner only.**
--     Any chef still manages cooks (permissions, removal) and may step down themselves.
--   • The owner cannot be removed or demoted by anyone, and cannot step down or delete their
--     account while others remain without first handing ownership to another chef
--     (`transfer_ownership`). Otherwise the owner's leaving would leave nobody who could manage
--     the chefs.
--   • If `owner_id` is ever empty (an account deleted outside the app — `on delete set null`), any
--     chef acts as owner, so a kitchen is never left with nobody able to manage its chefs.
--
-- Until this is applied the app keeps working: the client reads `owner_id` defensively, the role
-- toggle reports "not available on the server yet" only for `transfer_ownership`, and the old
-- rules (every chef equal) stay in force.
--
-- The refusals here RAISE rather than return a status: none of these functions records an attempt
-- before deciding, so a rollback loses nothing (contrast `request_join`, 0008).

alter table public.restaurants
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

-- Backfill: the creator if they are still a chef here, else the longest-standing chef.
update public.restaurants r
   set owner_id = coalesce(
     (select m.user_id from public.memberships m
       where m.restaurant_id = r.id and m.user_id = r.created_by and m.role = 'chef'),
     (select m.user_id from public.memberships m
       where m.restaurant_id = r.id and m.role = 'chef'
       order by m.created_at, m.user_id limit 1)
   )
 where r.owner_id is null;

-- A new restaurant is owned by whoever creates it. A trigger rather than a change to
-- create_restaurant(), so that function does not have to be restated.
create or replace function public.restaurants_default_owner() returns trigger
language plpgsql as $$
begin
  if new.owner_id is null then new.owner_id := new.created_by; end if;
  return new;
end $$;

drop trigger if exists restaurants_default_owner on public.restaurants;
create trigger restaurants_default_owner before insert on public.restaurants
  for each row execute function public.restaurants_default_owner();

/** Whether `p_uid` may manage chefs at `p_rest`: the owner, or any chef while there is no owner. */
create or replace function public.acts_as_owner(p_rest uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.restaurants r
      join public.memberships m on m.restaurant_id = r.id and m.user_id = p_uid and m.role = 'chef'
     where r.id = p_rest
       and (r.owner_id = p_uid
            or r.owner_id is null
            or not exists (select 1 from public.memberships o
                            where o.restaurant_id = r.id and o.user_id = r.owner_id))
  );
$$;

-- ── set_member_permissions ────────────────────────────────────────────────────

create or replace function public.set_member_permissions(
  p_user_id uuid, p_role text, p_can_edit_recipes boolean, p_can_delete_recipes boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_restaurant_id uuid;
  v_caller_role text;
  v_target_role text;
  v_owner uuid;
  v_chef_count int;
begin
  select m.restaurant_id, m.role into v_restaurant_id, v_caller_role
    from public.memberships m where m.user_id = v_caller;
  if v_caller_role is distinct from 'chef' then
    raise exception 'forbidden_action' using errcode = '42501';
  end if;
  select m.role into v_target_role from public.memberships m
   where m.restaurant_id = v_restaurant_id and m.user_id = p_user_id;
  if v_target_role is null then
    raise exception 'no_such_member' using errcode = 'P0002';
  end if;
  if p_role not in ('chef', 'cook') then
    raise exception 'invalid_role';
  end if;
  select r.owner_id into v_owner from public.restaurants r where r.id = v_restaurant_id;

  if v_target_role <> p_role then
    if p_user_id = v_caller then
      -- Stepping down. The owner hands ownership on first; the last chef cannot step down at all.
      if p_user_id = v_owner then
        raise exception 'owner_must_transfer' using errcode = '42501';
      end if;
      select count(*) into v_chef_count from public.memberships m
       where m.restaurant_id = v_restaurant_id and m.role = 'chef';
      if v_chef_count <= 1 then
        raise exception 'last_chef' using errcode = '42501';
      end if;
    else
      -- Making or unmaking a chef is the owner's call.
      if not public.acts_as_owner(v_restaurant_id, v_caller) then
        raise exception 'owner_only' using errcode = '42501';
      end if;
      if p_user_id = v_owner then
        raise exception 'owner_protected' using errcode = '42501';
      end if;
    end if;
  elsif v_target_role = 'chef' and p_user_id <> v_caller
        and not public.acts_as_owner(v_restaurant_id, v_caller) then
    -- Another chef's flags: also the owner's (they are moot for a chef, but not a chef's business).
    raise exception 'owner_only' using errcode = '42501';
  end if;

  update public.memberships
     set role = p_role, can_edit_recipes = p_can_edit_recipes, can_delete_recipes = p_can_delete_recipes
   where restaurant_id = v_restaurant_id and user_id = p_user_id;
end $$;

-- ── remove_member ────────────────────────────────────────────────────────────

create or replace function public.remove_member(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_restaurant_id uuid;
  v_caller_role text;
  v_target_role text;
  v_owner uuid;
begin
  select m.restaurant_id, m.role into v_restaurant_id, v_caller_role
    from public.memberships m where m.user_id = v_caller;
  if v_caller_role is distinct from 'chef' then
    raise exception 'forbidden_action' using errcode = '42501';
  end if;
  if p_user_id = v_caller then
    raise exception 'cannot_remove_self' using errcode = '42501';
  end if;
  select m.role into v_target_role from public.memberships m
   where m.restaurant_id = v_restaurant_id and m.user_id = p_user_id;
  if v_target_role is null then
    raise exception 'no_such_member' using errcode = 'P0002';
  end if;
  select r.owner_id into v_owner from public.restaurants r where r.id = v_restaurant_id;
  if p_user_id = v_owner then
    raise exception 'owner_protected' using errcode = '42501';
  end if;
  if v_target_role = 'chef' and not public.acts_as_owner(v_restaurant_id, v_caller) then
    raise exception 'owner_only' using errcode = '42501';
  end if;

  delete from public.memberships where restaurant_id = v_restaurant_id and user_id = p_user_id;
end $$;

-- ── transfer_ownership ───────────────────────────────────────────────────────

/** Hands the restaurant to another chef. The caller stays a chef. */
create or replace function public.transfer_ownership(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_caller uuid := auth.uid();
  v_restaurant_id uuid;
begin
  if v_caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select m.restaurant_id into v_restaurant_id from public.memberships m where m.user_id = v_caller;
  if v_restaurant_id is null or not public.acts_as_owner(v_restaurant_id, v_caller) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships m
                  where m.restaurant_id = v_restaurant_id and m.user_id = p_user_id and m.role = 'chef') then
    raise exception 'transfer_needs_chef' using errcode = '42501';
  end if;
  update public.restaurants set owner_id = p_user_id where id = v_restaurant_id;
end $$;

-- ── delete_my_account ────────────────────────────────────────────────────────

-- As 0007, plus: the owner of a kitchen that still has other members hands ownership on first.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid         uuid := auth.uid();
  v_rest        uuid;
  v_role        text;
  v_owner       uuid;
  v_others      int;
  v_other_chefs int;
  v_dropped     boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select m.restaurant_id, m.role into v_rest, v_role
    from public.memberships m where m.user_id = v_uid;

  if v_rest is not null then
    select count(*),
           count(*) filter (where m.role = 'chef')
      into v_others, v_other_chefs
      from public.memberships m
     where m.restaurant_id = v_rest and m.user_id <> v_uid;
    select r.owner_id into v_owner from public.restaurants r where r.id = v_rest;

    if v_others = 0 then
      delete from public.restaurants where id = v_rest;
      v_dropped := true;
    elsif v_role = 'chef' and v_other_chefs = 0 then
      raise exception 'last_chef_account' using errcode = '42501';
    elsif v_owner = v_uid then
      raise exception 'owner_must_transfer' using errcode = '42501';
    else
      delete from public.memberships where user_id = v_uid;
    end if;
  end if;

  delete from auth.users where id = v_uid;
  return jsonb_build_object('status', 'deleted', 'restaurantDeleted', v_dropped);
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────

revoke all on function public.acts_as_owner(uuid, uuid) from public;
revoke all on function public.transfer_ownership(uuid) from public;
grant execute on function public.transfer_ownership(uuid) to authenticated;
grant execute on function public.set_member_permissions(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
