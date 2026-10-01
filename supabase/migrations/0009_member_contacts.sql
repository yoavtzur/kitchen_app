-- 0009 — a phone number that outlives the join request, and a way for the team to reach each other.
--
-- Until now a phone number existed in exactly one place: `join_requests.phone`, which is deleted the
-- moment a chef approves the request (0008 says so on purpose — it is personal data and has no
-- business outliving the question it was asked for). So an approved cook's number was gone the
-- instant the chef needed it, and there was no way for anyone to add or change theirs afterwards.
--
-- Why a table of its own and not a column on `memberships`: `memberships_read` lets every teammate
-- read every membership row at their restaurant (0003), which is right for role and cook binding
-- and wrong for a phone number — a cook has no claim on another cook's. Here RLS is on with no
-- policy and no grant (like `scan_usage` and `join_requests`), so the RPCs below are the only way
-- in and they decide who sees what:
--   * a person reads and writes their own number;
--   * a chef reads everyone's number and e-mail at their restaurant;
--   * a cook reads only the chef's number — "how do I reach the chef" is the use case, and nothing
--     is gained by handing every cook the whole kitchen's phone book.
--
-- Erasure: both foreign keys cascade. This is personal data, not the restaurant's record (that was
-- the argument for `set null` on `ops`), so it goes with the account — and with the membership
-- (trigger below), so a removed cook's number does not linger.

create table if not exists public.member_contacts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  phone         text not null check (char_length(phone) between 1 and 20),
  updated_at    timestamptz not null default now()
);
create index if not exists member_contacts_restaurant on public.member_contacts (restaurant_id);
alter table public.member_contacts enable row level security;

-- A removed teammate takes their number with them.
create or replace function public.drop_contact_with_membership() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.member_contacts c where c.user_id = old.user_id;
  return old;
end $$;

drop trigger if exists memberships_drop_contact on public.memberships;
create trigger memberships_drop_contact
  after delete on public.memberships
  for each row execute function public.drop_contact_with_membership();

/** The caller's own number, or null. */
create or replace function public.get_my_phone() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_phone text;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select c.phone into v_phone from public.member_contacts c where c.user_id = v_uid;
  return v_phone;
end $$;

/** Sets the caller's own number; an empty string removes it. Members only — a number needs a
 * kitchen to belong to, and a person who is not in one has nobody to share it with. */
create or replace function public.set_my_phone(p_phone text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rest uuid; v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select m.restaurant_id into v_rest from public.memberships m where m.user_id = v_uid;
  if v_rest is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if v_phone is null then
    delete from public.member_contacts c where c.user_id = v_uid;
    return;
  end if;
  if char_length(v_phone) > 20 then raise exception 'phone_too_long' using errcode = '22023'; end if;
  insert into public.member_contacts (user_id, restaurant_id, phone) values (v_uid, v_rest, v_phone)
  on conflict (user_id) do update set phone = excluded.phone, restaurant_id = excluded.restaurant_id, updated_at = now();
end $$;

/**
 * Who can be reached, and how. One row per person the caller is allowed to know about: a chef gets
 * every member (phone and e-mail), anyone else gets the chefs (phone only — no e-mail). Always one
 * row per allowed member even when they have no number, so the screen can say "no number yet"
 * instead of silently leaving them out.
 */
create or replace function public.list_team_contacts()
returns table (user_id uuid, cook_id text, role text, phone text, email text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_rest uuid; v_role text;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select m.restaurant_id, m.role into v_rest, v_role
    from public.memberships m where m.user_id = v_uid;
  if v_rest is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return query
    select m.user_id, m.cook_id, m.role, c.phone,
           case when v_role = 'chef' then u.email::text else null end
      from public.memberships m
      left join public.member_contacts c on c.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
     where m.restaurant_id = v_rest
       and (v_role = 'chef' or m.role = 'chef');
end $$;

/**
 * 0008's approval, plus one line: the number the cook typed when asking to join becomes their
 * contact number instead of being deleted with the request. Everything else is unchanged.
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
  if v_req.phone is not null then
    insert into public.member_contacts (user_id, restaurant_id, phone)
    values (p_user_id, v_rest, v_req.phone)
    on conflict (user_id) do nothing;
  end if;
  delete from public.join_requests jr where jr.user_id = p_user_id;
  return 'approved';
end $$;

revoke all on function
  public.get_my_phone(), public.set_my_phone(text), public.list_team_contacts()
  from public;
grant execute on function
  public.get_my_phone(), public.set_my_phone(text), public.list_team_contacts()
  to authenticated;
