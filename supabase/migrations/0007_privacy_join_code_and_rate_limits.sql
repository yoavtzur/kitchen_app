-- Privacy, account deletion, join-code rotation, and a ceiling on join-code guessing.
--
-- APPLY THIS BY HAND in the Supabase SQL editor, as the project's `postgres` role, before
-- deploying the code that calls it. Nothing in the build applies migrations. Until it lands,
-- the three new RPCs return "function does not exist" and the Settings UI reports that error —
-- the app keeps working in every other respect, so the order of deploy vs. apply is not
-- load-bearing here the way it was for 0006.
--
-- Four separate problems, one migration because they all touch the same two tables:
--
--   1. There was no way for an account to be deleted, by anyone, ever. That is a GDPR
--      obligation (Art. 17) before it is a feature.
--   2. `join_code` was fixed for the life of a restaurant. A cook who leaves keeps a working
--      key to the kitchen, and a code read aloud in a busy room stays valid forever.
--   3. Nothing rate-limited `join_restaurant`. Six characters from a 32-character alphabet is
--      ~1.07e9 codes, which is ample against a human and nothing at all against a script.
--   4. Two foreign keys into `auth.users` had no ON DELETE rule, so deleting an account was
--      blocked by the database itself. See the comment on that block below — the fix is the
--      interesting part of this file.

-- ── auth.users references: sever the person, keep the kitchen ─────────────────
--
-- `ops.user_id` and `restaurants.created_by` both reference auth.users with no ON DELETE
-- action, so the first `delete from auth.users` raises a foreign-key violation and the account
-- cannot be removed at all.
--
-- The fix is NOT to cascade. An op is the restaurant's data — "60 eggs counted on Tuesday" —
-- and cascading would delete a departing cook's entire contribution to a kitchen that is still
-- operating, silently rewriting its history and its stock levels. What is personal here is the
-- *link* from the op to the person, and severing that link is exactly what erasure means:
-- the record of the work stays with the restaurant, the record of who did it does not.
--
-- Same reasoning for `created_by`: after creation it is provenance, not a functional field —
-- nothing reads it, and ownership is expressed by `memberships.role = 'chef'`.

alter table public.ops alter column user_id drop not null;
alter table public.ops drop constraint if exists ops_user_id_fkey;
alter table public.ops add constraint ops_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.restaurants alter column created_by drop not null;
alter table public.restaurants drop constraint if exists restaurants_created_by_fkey;
alter table public.restaurants add constraint restaurants_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- ── join-attempt quotas ──────────────────────────────────────────────────────

alter table public.app_config
  add column if not exists join_quota_user   int not null default 10,
  add column if not exists join_quota_global int not null default 500;

-- 0006 left this constraint narrow on purpose ("only today's three scopes can be written
-- today") and noted that phase 6 would widen it. This is that.
alter table public.scan_usage drop constraint if exists scan_usage_scope_check;
alter table public.scan_usage add constraint scan_usage_scope_check
  check (scope in ('user', 'restaurant', 'global', 'join_user', 'join_global'));

-- ── join_restaurant: same behaviour, now with a ceiling ──────────────────────

/**
 * Unchanged for anyone typing a real code. What is new is the two counters, and the asymmetry
 * between them is the whole design:
 *
 *   • EVERY attempt bumps the per-account counter. That is what stops one account grinding
 *     through the code space.
 *   • Only a FAILED attempt bumps the global counter, and the global ceiling is therefore
 *     consulted only on a lookup that already missed. So a correct code always works, no
 *     matter how full the global bucket is. Without that split, the global limit would be a
 *     denial-of-service switch anyone could flip: exhaust it with garbage and no cook in any
 *     restaurant can join for the rest of the day.
 *
 * Signup is open and email confirmation is off, so the per-account limit alone bounds nothing —
 * an attacker mints a fresh account every ten guesses. The global counter is the real ceiling,
 * and the split above is what makes it safe to set low.
 *
 * Counting happens before judging, exactly as in consume_scan_quota(): hammering an
 * already-exhausted account costs the attacker the same as a legitimate call, so there is no
 * cheap probe for "am I still allowed to guess".
 */
create or replace function public.join_restaurant(p_code text)
returns table (restaurant_id uuid, name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     uuid;
  v_name   text;
  v_uid    uuid := auth.uid();
  v_day    date := (now() at time zone 'Asia/Jerusalem')::date;
  v_nil    uuid := '00000000-0000-0000-0000-000000000000';
  v_cfg    public.app_config;
  v_used   int;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;

  select * into v_cfg from public.app_config where id;

  insert into public.scan_usage (day, scope, scope_id, used)
  values (v_day, 'join_user', v_uid, 1)
  on conflict (day, scope, scope_id) do update set used = public.scan_usage.used + 1
  returning used into v_used;
  if v_used > coalesce(v_cfg.join_quota_user, 10) then
    raise exception 'too_many_join_attempts' using errcode = 'P0003';
  end if;

  select r.id, r.name into v_id, v_name
    from public.restaurants r where r.join_code = upper(btrim(p_code));

  if v_id is null then
    insert into public.scan_usage (day, scope, scope_id, used)
    values (v_day, 'join_global', v_nil, 1)
    on conflict (day, scope, scope_id) do update set used = public.scan_usage.used + 1
    returning used into v_used;
    if v_used > coalesce(v_cfg.join_quota_global, 500) then
      raise exception 'too_many_join_attempts' using errcode = 'P0003';
    end if;
    raise exception 'invalid_code' using errcode = 'P0002';
  end if;

  -- Named-constraint form, not `on conflict (restaurant_id, user_id)`: this function's own
  -- `returns table (restaurant_id, ...)` declares restaurant_id as an OUT parameter, and a bare
  -- column-list conflict target is ambiguous against it (42702) — see 0002_fix_join_restaurant.sql.
  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_uid, 'cook')
  on conflict on constraint memberships_pkey do nothing;
  return query select v_id, v_name;
end $$;

-- ── rotate_join_code: a key that can be changed ──────────────────────────────

/**
 * Chef-only. Generates a fresh code for the caller's own restaurant and returns it, retrying on
 * the (vanishingly unlikely) unique collision exactly as create_restaurant does.
 *
 * Takes no restaurant id: it acts on the caller's membership, so there is nothing to lie about.
 * Everyone who had the old code loses it immediately — which is the point, and is why the UI
 * asks for confirmation first.
 */
create or replace function public.rotate_join_code() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rest uuid; v_role text; v_code text; v_try int := 0;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select m.restaurant_id, m.role into v_rest, v_role
    from public.memberships m where m.user_id = v_uid;
  if v_rest is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if v_role <> 'chef' then raise exception 'chef_only' using errcode = '42501'; end if;

  loop
    v_try := v_try + 1;
    v_code := public.gen_join_code();
    begin
      update public.restaurants set join_code = v_code where id = v_rest;
      exit;
    exception when unique_violation then
      if v_try > 10 then raise; end if;
    end;
  end loop;
  return v_code;
end $$;

-- ── delete_my_account: erasure, in one transaction ───────────────────────────

/**
 * Deletes the caller's account and everything personal about them, and returns what it did:
 *   {"status":"deleted","restaurantDeleted":true|false}
 *
 * Three cases, and the middle one is the only judgement call:
 *
 *   • Not a member of anything → just the account.
 *   • The last member of a restaurant → the restaurant goes too. Snapshots and ops cascade
 *     from `restaurants`, so a solo user's kitchen data leaves with them, which is what
 *     erasure has to mean for someone whose data is the whole restaurant.
 *   • A chef with teammates and no other chef → REFUSED (`last_chef_account`). Deleting here would
 *     leave a working kitchen that nobody can administer: no one could grant permissions,
 *     remove a member or rotate the join code, and there is no server-side path to appoint a
 *     replacement. Promote someone first. This is the one case where the account is not
 *     immediately erasable, and it is resolvable by the user in two taps, which is what makes
 *     it a defensible answer rather than a refusal to comply.
 *
 * The final `delete from auth.users` is what makes this real rather than a soft delete: the
 * email, the password hash and the session all go. It works because a SECURITY DEFINER function
 * created from the SQL editor is owned by `postgres`, which holds the necessary privilege on
 * `auth.users`. If a future project locks that down, this raises `42501` and the whole
 * transaction rolls back — nothing is half-deleted — and the fallback is an Edge Function
 * calling `auth.admin.deleteUser()` with the service-role key.
 *
 * Note the ordering: memberships cascade from auth.users anyway, but the restaurant cleanup has
 * to happen while the membership rows are still there to be counted.
 */
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid         uuid := auth.uid();
  v_rest        uuid;
  v_role        text;
  v_others      int;
  v_other_chefs int;
  v_dropped     boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select m.restaurant_id, m.role into v_rest, v_role
    from public.memberships m where m.user_id = v_uid;

  if v_rest is not null then
    select count(*) filter (where true),
           count(*) filter (where m.role = 'chef')
      into v_others, v_other_chefs
      from public.memberships m
     where m.restaurant_id = v_rest and m.user_id <> v_uid;

    if v_others = 0 then
      -- Last one out. snapshots, ops and this membership all cascade from restaurants.
      delete from public.restaurants where id = v_rest;
      v_dropped := true;
    elsif v_role = 'chef' and v_other_chefs = 0 then
      raise exception 'last_chef_account' using errcode = '42501';
    else
      delete from public.memberships where user_id = v_uid;
    end if;
  end if;

  delete from auth.users where id = v_uid;
  return jsonb_build_object('status', 'deleted', 'restaurantDeleted', v_dropped);
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────

revoke all on function public.rotate_join_code(), public.delete_my_account() from public;
grant execute on function public.rotate_join_code(), public.delete_my_account() to authenticated;
