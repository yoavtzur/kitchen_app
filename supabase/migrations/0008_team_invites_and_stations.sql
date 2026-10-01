-- Inviting a cook with a one-time link, chef approval before anyone gets in, and chef-only
-- station management.
--
-- APPLY THIS BY HAND in the Supabase SQL editor, as the project's `postgres` role, **before**
-- deploying the client that calls it. Nothing in the build applies migrations. Until it lands, a
-- new client's calls to these RPCs return PGRST202 ("function does not exist") and the screens
-- that use them report "the server has not been updated yet" — and the app otherwise keeps
-- working. The reverse order is worse: an OLD client keeps calling `join_restaurant`, which this
-- migration turns into a refusal (see below), so applying it ahead of the client blocks new
-- cooks from joining until the client ships.
--
-- Two unrelated things in one file because both change how `append_ops` and the join path
-- decide who is allowed to do what:
--
--   1. **Joining now needs a chef's approval.** Until this, anyone holding the six-character
--      join code was a member the instant they typed it: a cook who left, a code read aloud in
--      a busy room, a photo of the fridge door. Membership is what `is_member()` — and through it
--      every RLS policy and `append_ops` — treats as full access to the kitchen's data, so a
--      "pending" person must not be a membership row at all. They live in `join_requests`, which
--      no policy can reach, and become a membership only when a chef resolves the request.
--   2. **Renaming and deleting a station are chef-only.** Stations are structure, not stock; a
--      cook has no business removing the line a whole prep list hangs from. `action_requires`
--      returned null (open to any member) for every action it did not list, so the new action
--      types needed an explicit entry — and a new kind of requirement, 'chef'.

-- ── 1. chef-only station actions ─────────────────────────────────────────────

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
    -- Adding a station stays open: RecipeEditor and the manual-task sheet create one inline for
    -- anyone who may edit recipes. Renaming and deleting reshape the kitchen for everyone, and a
    -- delete re-points every recipe at another station.
    when 'RENAME_STATION' then 'chef'
    when 'DELETE_STATION' then 'chef'
    else null
  end;
$$;

-- Identical to 0003's append_ops apart from the one `chef` branch in the permission loop. It is
-- restated in full because there is no way to patch a function body in place.
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
      if v_required = 'chef' then
        raise exception 'forbidden_action' using errcode = '42501';
      end if;
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

-- ── 2. invites: one link per cook ────────────────────────────────────────────

-- Only a SHA-256 of the token is stored, so a read of this table (a backup, a leaked dump)
-- yields nothing that can be used to join. RLS on with no policy and no grant, like scan_usage:
-- the RPCs below are the only reachable path.
create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash    text not null unique,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid references auth.users(id) on delete set null
);
create index invites_restaurant on public.invites (restaurant_id);
alter table public.invites enable row level security;

-- ── 3. join_requests: waiting outside the kitchen ────────────────────────────

-- Deliberately NOT a status on `memberships`. is_member() — and so every SELECT policy and
-- append_ops — treats the existence of a membership row as full access, so a pending person
-- stored there would read the whole restaurant. Here they are invisible to all of it: RLS on, no
-- policy, no grant.
--
-- Personal data (a name and an optional phone number), so it cascades away with the account and
-- is deleted the moment a chef resolves the request into a membership.
create table public.join_requests (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  first_name    text not null check (char_length(btrim(first_name)) between 1 and 40),
  last_name     text not null check (char_length(btrim(last_name))  between 1 and 40),
  phone         text check (phone is null or char_length(phone) <= 20),
  status        text not null default 'pending' check (status in ('pending', 'rejected')),
  invite_id     uuid references public.invites(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index join_requests_restaurant on public.join_requests (restaurant_id);
alter table public.join_requests enable row level security;

-- ── 4. RPCs ──────────────────────────────────────────────────────────────────

/**
 * Chef-only. Makes a link good for 72 hours and returns the token — the one and only time it is
 * ever visible, since only its hash is kept. Takes no restaurant id: it acts on the caller's own
 * membership, so there is nothing to lie about.
 */
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rest uuid; v_role text; v_token text; v_open int;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select m.restaurant_id, m.role into v_rest, v_role
    from public.memberships m where m.user_id = v_uid;
  if v_rest is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if v_role <> 'chef' then raise exception 'chef_only' using errcode = '42501'; end if;

  -- Housekeeping on the write path rather than a cron: the table only grows by a chef pressing a
  -- button, so the cost is proportional to something a person did.
  delete from public.invites i
   where i.restaurant_id = v_rest and i.expires_at < now() - interval '7 days';

  select count(*) into v_open from public.invites i
   where i.restaurant_id = v_rest and i.used_at is null and i.expires_at > now();
  if v_open >= 50 then raise exception 'too_many_invites' using errcode = '54000'; end if;

  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.invites (restaurant_id, token_hash, created_by, expires_at)
  values (v_rest, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_uid, now() + interval '72 hours');
  return v_token;
end $$;

/**
 * Lets a signed-in person see which kitchen an invite is for before they commit to it. Returns
 * 'valid' | 'invalid' | 'expired' | 'used'. Authenticated only, deliberately not `anon`: the
 * sign-in screen shows a generic "you were invited" line, and the kitchen's name is revealed only
 * once there is an account behind the question.
 */
create or replace function public.peek_invite(p_token text)
returns table (status text, restaurant_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_inv public.invites; v_name text;
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '42501'; end if;
  select * into v_inv from public.invites i
   where i.token_hash = encode(sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8')), 'hex');
  if not found then
    return query select 'invalid'::text, null::text; return;
  end if;
  if v_inv.used_at is not null then
    return query select 'used'::text, null::text; return;
  end if;
  if v_inv.expires_at <= now() then
    return query select 'expired'::text, null::text; return;
  end if;
  select r.name into v_name from public.restaurants r where r.id = v_inv.restaurant_id;
  return query select 'valid'::text, v_name;
end $$;

/**
 * Asks to join a kitchen, by invite token or by the six-character code, and records who is asking.
 * Never creates a membership: that is `resolve_join_request`, and only a chef can call it.
 *
 * **Returns a `status` instead of raising** — the lesson of 0007, which is why this has the shape
 * it has: RAISE aborts the transaction and rolls back the counter bump the refusal was based on,
 * so a limiter that raises counts nothing. Same two counters and the same asymmetry as before:
 *
 *   • every attempt bumps the per-account counter;
 *   • only a FAILED lookup bumps the global one, and the global ceiling is consulted only then —
 *     so a correct code or a live invite always works however full the global bucket is, and the
 *     limit cannot be flipped into a denial-of-service switch.
 *
 * Statuses: 'pending' | 'invalid_code' | 'invalid_invite' | 'invalid_name' | 'already_member' |
 * 'full' | 'rate_limited'.  `full` is a cap on waiting requests per kitchen (20): signup is open,
 * so anyone who has ever seen the code could otherwise bury the chef's banner in junk requests.
 *
 * An invite is claimed (marked used) only after every check that could still refuse the request,
 * and the claim is a conditional UPDATE, so two people racing for one link cannot both get it and
 * a refusal never burns a link.
 */
create or replace function public.request_join(
  p_code text, p_token text, p_first text, p_last text, p_phone text
) returns table (status text, restaurant_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_day     date := (now() at time zone 'Asia/Jerusalem')::date;
  v_nil     uuid := '00000000-0000-0000-0000-000000000000';
  v_cfg     public.app_config;
  v_used    int;
  v_first   text := btrim(coalesce(p_first, ''));
  v_last    text := btrim(coalesce(p_last, ''));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_hash    text;
  v_rest    uuid;
  v_name    text;
  v_invite  uuid;
  v_existing public.join_requests;
  v_by_token boolean := nullif(btrim(coalesce(p_token, '')), '') is not null;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;

  select * into v_cfg from public.app_config where id;

  -- Same CTE shape as join_restaurant in 0007 (the form proven to compile on the live project).
  with bumped as (
    insert into public.scan_usage (day, scope, scope_id, used)
    values (v_day, 'join_user', v_uid, 1)
    on conflict (day, scope, scope_id) do update set used = public.scan_usage.used + 1
    returning scan_usage.used
  )
  select b.used into v_used from bumped b;

  if v_used > coalesce(v_cfg.join_quota_user, 10) then
    return query select 'rate_limited'::text, null::text; return;
  end if;

  if char_length(v_first) not between 1 and 40 or char_length(v_last) not between 1 and 40
     or (v_phone is not null and char_length(v_phone) > 20) then
    return query select 'invalid_name'::text, null::text; return;
  end if;

  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    return query select 'already_member'::text, null::text; return;
  end if;

  select * into v_existing from public.join_requests jr where jr.user_id = v_uid;
  if found then
    if v_existing.status = 'pending' then
      -- Idempotent: tapping twice, or a retry after a dropped response, must not error.
      select r.name into v_name from public.restaurants r where r.id = v_existing.restaurant_id;
      return query select 'pending'::text, v_name; return;
    end if;
    -- A rejected request is replaced by a fresh one; the rejection was already seen or is moot.
    delete from public.join_requests jr where jr.user_id = v_uid;
  end if;

  if v_by_token then
    v_hash := encode(sha256(convert_to(btrim(p_token), 'UTF8')), 'hex');
    select i.restaurant_id, i.id into v_rest, v_invite
      from public.invites i
     where i.token_hash = v_hash and i.used_at is null and i.expires_at > now();
  else
    select r.id into v_rest from public.restaurants r where r.join_code = upper(btrim(coalesce(p_code, '')));
  end if;

  if v_rest is null then
    with bumped as (
      insert into public.scan_usage (day, scope, scope_id, used)
      values (v_day, 'join_global', v_nil, 1)
      on conflict (day, scope, scope_id) do update set used = public.scan_usage.used + 1
      returning scan_usage.used
    )
    select b.used into v_used from bumped b;

    if v_used > coalesce(v_cfg.join_quota_global, 500) then
      return query select 'rate_limited'::text, null::text;
    elsif v_by_token then
      return query select 'invalid_invite'::text, null::text;
    else
      return query select 'invalid_code'::text, null::text;
    end if;
    return;
  end if;

  if (select count(*) from public.join_requests jr
       where jr.restaurant_id = v_rest and jr.status = 'pending') >= 20 then
    return query select 'full'::text, null::text; return;
  end if;

  if v_invite is not null then
    update public.invites i set used_at = now(), used_by = v_uid
     where i.id = v_invite and i.used_at is null;
    if not found then
      return query select 'invalid_invite'::text, null::text; return;
    end if;
  end if;

  insert into public.join_requests (user_id, restaurant_id, first_name, last_name, phone, invite_id)
  values (v_uid, v_rest, v_first, v_last, v_phone, v_invite);

  select r.name into v_name from public.restaurants r where r.id = v_rest;
  return query select 'pending'::text, v_name;
end $$;

/**
 * Where does the caller stand? 'member' | 'pending' | 'rejected' | 'none', plus what they typed
 * and the kitchen's name, so the waiting screen can say "waiting for the chef of X". This is what
 * a waiting cook polls: they are not a member yet, so realtime — which rides on the very RLS
 * that keeps them out — cannot reach them, and a plain RPC is both simpler and the correct shape.
 */
create or replace function public.my_join_status()
returns table (status text, restaurant_name text, first_name text, last_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_req public.join_requests; v_name text;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    return query select 'member'::text, null::text, null::text, null::text; return;
  end if;
  select * into v_req from public.join_requests jr where jr.user_id = v_uid;
  if not found then
    return query select 'none'::text, null::text, null::text, null::text; return;
  end if;
  select r.name into v_name from public.restaurants r where r.id = v_req.restaurant_id;
  return query select v_req.status, v_name, v_req.first_name, v_req.last_name;
end $$;

/** Chef-only: the people waiting at the door, oldest first. Pending only — a rejected request
 * is the requester's to see, not a to-do for the chef. */
create or replace function public.list_join_requests()
returns table (user_id uuid, first_name text, last_name text, phone text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_rest uuid; v_role text;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select m.restaurant_id, m.role into v_rest, v_role
    from public.memberships m where m.user_id = v_uid;
  if v_rest is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if v_role <> 'chef' then raise exception 'chef_only' using errcode = '42501'; end if;
  return query
    select jr.user_id, jr.first_name, jr.last_name, jr.phone, jr.created_at
      from public.join_requests jr
     where jr.restaurant_id = v_rest and jr.status = 'pending'
     order by jr.created_at;
end $$;

/**
 * Chef-only. Approving turns the request into a `cook` membership bound to `p_cook_id` — the
 * `Cook` row the chef's client has just added to the restaurant's state, which is why an approved
 * cook never sees the "who am I" screen. Rejecting keeps a marker so the cook can be told, and is
 * cleared by `dismiss_join_rejection`.
 *
 * Returns 'approved' | 'rejected' | 'already_member'. The last is the one benign way an approval
 * can fail: the person joined another kitchen in the meantime (one kitchen per account), so the
 * request is simply dropped.
 */
create or replace function public.resolve_join_request(p_user_id uuid, p_approve boolean, p_cook_id text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_rest uuid; v_role text; v_req public.join_requests;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select m.restaurant_id, m.role into v_rest, v_role
    from public.memberships m where m.user_id = v_uid;
  if v_rest is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if v_role <> 'chef' then raise exception 'chef_only' using errcode = '42501'; end if;

  select * into v_req from public.join_requests jr
   where jr.user_id = p_user_id and jr.restaurant_id = v_rest and jr.status = 'pending'
   for update;
  if not found then raise exception 'no_such_request' using errcode = 'P0002'; end if;

  if not p_approve then
    update public.join_requests jr set status = 'rejected' where jr.user_id = p_user_id;
    return 'rejected';
  end if;

  if nullif(btrim(coalesce(p_cook_id, '')), '') is null then
    raise exception 'cook_id_required' using errcode = '22023';
  end if;
  begin
    insert into public.memberships (restaurant_id, user_id, role, cook_id)
    values (v_rest, p_user_id, 'cook', p_cook_id);
  exception when unique_violation then
    delete from public.join_requests jr where jr.user_id = p_user_id;
    return 'already_member';
  end;
  delete from public.join_requests jr where jr.user_id = p_user_id;
  return 'approved';
end $$;

/** The requester acknowledging a rejection (or withdrawing a pending request): removes their own
 * row so they can ask again. Touches nobody else's. */
create or replace function public.dismiss_join_rejection() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'auth required' using errcode = '42501'; end if;
  delete from public.join_requests jr where jr.user_id = auth.uid();
end $$;

/**
 * The pre-0008 entry point, kept as a REFUSAL rather than dropped or left alone.
 *
 * Left alone, it would go on turning a code into an instant membership for any client still
 * running the old bundle — a service-worker-cached PWA can stay on an old build for days — and
 * that would be a standing way around the approval this migration introduces. Dropped, an old
 * client would get a confusing "function does not exist". Returning 'approval_required' with no
 * side effects (not even a counter bump) closes the hole and, mapped by the old client's
 * `mapJoinStatus` default, shows its generic "joining failed" message until it refreshes.
 */
drop function if exists public.join_restaurant(text);
create function public.join_restaurant(p_code text)
returns table (restaurant_id uuid, name text, status text)
language sql security definer set search_path = public, pg_temp as $$
  select null::uuid, null::text, 'approval_required'::text;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────

revoke all on function
  public.create_invite(), public.peek_invite(text),
  public.request_join(text, text, text, text, text), public.my_join_status(),
  public.list_join_requests(), public.resolve_join_request(uuid, boolean, text),
  public.dismiss_join_rejection(), public.join_restaurant(text)
  from public;
grant execute on function
  public.create_invite(), public.peek_invite(text),
  public.request_join(text, text, text, text, text), public.my_join_status(),
  public.list_join_requests(), public.resolve_join_request(uuid, boolean, text),
  public.dismiss_join_rejection(), public.join_restaurant(text)
  to authenticated;
