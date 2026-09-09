-- Dated order history: OrderLine gains a `date` field so the supply sheet becomes a history the
-- cook can learn from instead of one static snapshot. Idempotent (guarded on schema_version < 4).
--
-- Why this migration rewrites jsonb instead of altering a table: there is no `order_lines`
-- table — every order line lives inside `snapshots.state.orderLines`, a jsonb array inside the
-- single blob every restaurant's data is stored in (see 0001_init.sql's design notes and
-- 0003_rls_and_granular_roles.sql's comment on why RLS can't reach inside it either). Bumping
-- the client's SCHEMA_VERSION (see src/data/seed.ts) without also updating what's already
-- stored on the server would flip every synced client to 'upgrade-required' (the Phase 6
-- mechanism in src/sync/engine.ts) forever, since no amount of incoming ops changes a client's
-- own build. So this migration is the server-side half of that schema bump: it stamps every
-- existing order line (across every restaurant) with today's date, exactly mirroring
-- src/store/storage.ts's migrateV3toV4 for local/localStorage state.
--
-- RLS is untouched: there is no new table, so no new policy is needed.

do $$
declare
  r record;
  v_today text := to_char(now(), 'YYYY-MM-DD');
begin
  for r in select restaurant_id, state from public.snapshots loop
    if coalesce((r.state ->> 'schemaVersion')::int, 0) >= 4 then
      continue;
    end if;

    update public.snapshots
       set state = jsonb_set(
             jsonb_set(
               r.state,
               '{orderLines}',
               coalesce(
                 (
                   select jsonb_agg(
                     case when line ? 'date' then line else line || jsonb_build_object('date', v_today) end
                   )
                   from jsonb_array_elements(coalesce(r.state -> 'orderLines', '[]'::jsonb)) as line
                 ),
                 '[]'::jsonb
               )
             ),
             '{schemaVersion}',
             '4'::jsonb
           ),
           updated_at = now()
     where restaurant_id = r.restaurant_id;
  end loop;

  update public.restaurants set schema_version = 4 where schema_version < 4;
end $$;
