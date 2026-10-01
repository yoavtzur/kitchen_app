-- 0010 — creating, editing and deleting a standing task is chef-only.
--
-- A standing task ("clean the shelves" every day) is a rule in the restaurant's snapshot that makes a
-- normal task each day it is due. The rule is structure, like a station: a cook has no business
-- adding or removing what the whole kitchen is told to do every morning. As with stations (0008),
-- `append_ops` is the only place that can say so — there is no table for RLS to guard — and it
-- already knows the 'chef' kind of requirement, so all this needs is three more entries in
-- `action_requires`.
--
-- **MATERIALIZE_RECURRING stays open to every member, on purpose.** It is the day-start action that
-- turns the rules into today's tasks, and it is sent by whichever device opens the app first —
-- very often a cook's. Making it chef-only would mean no task appears until a chef happens to log in.
-- It carries no data a client could abuse: it is a pure function of the state and the date.
--
-- Until this is applied the app still works — the three actions are simply open to any member, which
-- is how the client has always behaved for an action the server does not list — so applying it is
-- not a blocking step.

-- Identical to 0008's, plus the three chef entries at the bottom. A function body cannot be patched
-- in place, so it is restated in full.
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
    when 'ADD_RECURRING_TASK'    then 'chef'
    when 'UPDATE_RECURRING_TASK' then 'chef'
    when 'DELETE_RECURRING_TASK' then 'chef'
    else null
  end;
$$;
