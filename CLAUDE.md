# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Hebrew-language (RTL), mobile-first kitchen management PWA for a restaurant: tracks raw-ingredient and prepared-product inventory, recipes, a weekly/daily consumption plan, auto-derived daily prep tasks, and a supply order sheet. React + TypeScript + Vite.

**Two modes, same app:** with no Supabase project configured, it's exactly what it always was — fully client-only, all state in the browser's `localStorage`, no account, no network. With `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` set, every cook signs up, joins their restaurant with a 6-character code, and the whole `AppState` syncs in real time across every device at that restaurant, with an offline queue for bad kitchen wifi. See **"Multi-device sync"** below for the architecture, and **"⚠ Continuing this work"** at the very bottom for exactly where this stands and what's left.

## Commands

```bash
npm run dev       # start Vite dev server
npm run build     # tsc -b && vite build — always run this (not just `vitest`) before considering a change done
npm run test      # vitest run (single run, not watch mode)
npm run lint      # oxlint
npm run preview   # preview a production build
```

Run a single test file: `npx vitest run src/lib/__tests__/calc.test.ts`

There are 42 test files (622 tests), colocated in `__tests__` folders next to what they cover:
`src/lib/__tests__/` (calc, date, ids, integrity, tasks, swipe, units-adjacent helpers, geminiScanner,
recipeDraft, migrateStations, sentry, analytics, appConfig, focusTrap, rpcErrors, nav, orders,
ingredientCategories, stations, syncIndicator, invite, cookName, phone, todayFilter, restore, receiving, notices, quickActions, carryOver, recurring, taskRow),
`src/store/__tests__/{reducer,storage,importValidation}.test.ts`,
`src/sync/__tests__/{backoff,engine,localAdapter,log,persist}.test.ts`, and **`api/__tests__/` — the one
test directory outside `src/`**, covering the scan endpoint's guards (see "Closing /api/scan-recipe").

No jsdom, no React Testing Library — everything is tested as pure functions in node, including the
entire sync protocol. **This is a deliberate constraint, not a gap**: anything that needs a browser to
verify is checked live instead, per the branch workflow below. Several real bugs in this codebase were
found only that way (a checkbox that was `display: none` on screen, a service-worker cold start that
looked fine because a same-hash `goto` never reloaded the document) and no unit test would have caught
either.

The browser half of that is not ad hoc any more: `scripts/verify-a11y-ui.mjs` and
`scripts/verify-auth-forms.mjs` drive a real Chromium over the things no node test can see — the
focus ring, the sheet's scroll lock and trapped Tab, one `Escape` closing only the innermost of two
nested sheets, the toast landing on screen rather than off the bottom of a long document, and the
column counts at each breakpoint. `scripts/verify-legal-and-account.mjs` is the third, and differs in one way worth copying: it
starts **its own two dev servers**, one with placeholder Supabase env vars and one without,
because "this route renders above the auth gate" can only be proved on a build where the gate is
actually on. It also pins the layout route by DOM node identity — `.bottom-nav` must be the same
node after two navigations, which is exactly what a per-route wrapper would break.

They need `npm install --no-save playwright` (deliberately not a
dependency); each file's header says exactly how to run it, and the phase 5 pair also needs a
dev server already running.

## Git & deployment

The repo lives at **github.com/yoavtzur/kitchen_app** (private), remote `origin`. Local git identity
(`user.name`/`user.email`) is set repo-locally, not globally — this machine had no global git identity
configured before this project needed one. Push/fetch auth is likewise repo-local: a fine-grained GitHub
PAT (kept at `C:\Users\yoavt\.github-kitchen-app-token`, outside the repo — same pattern as the Vercel
token below) is wired in via `git config http.https://github.com/.extraheader "Authorization: Basic …"`,
so plain `git push`/`git fetch` work without the token ever appearing in a remote URL or `git log`. If
that PAT is rotated, regenerate the header the same way (`base64` of `x-access-token:<new token>`) — it
needs at least **Contents: Read and write** on this one repo.

**Branch workflow (the point of wiring this up at all):** `main` is production — treat it as always
deployable, never push work-in-progress directly to it. Do real work on a feature branch, and only merge
into `main` once it's actually verified (tests pass, build is clean, and — for anything UI-observable —
checked live in the browser per this file's own testing conventions). Once Vercel's Git integration is
connected (see below), that merge is also what triggers the real production deploy — so "merge to main"
and "ship it" become the same action, which is the whole point of doing this instead of the ad hoc
`npx vercel --prod` this project used before.

**Every change goes through a preview before `main`:** never push a code change directly
to `main`. Do the work on a feature branch (new or existing), commit, and push it — this
alone makes Vercel build a Preview deployment automatically (no manual command needed).
Share that branch's stable preview link in chat: `https://app-git-<branch-name-with-slashes-as-dashes>-yoav16.vercel.app`
(e.g. branch `claude/foo-bar` → `https://app-git-claude-foo-bar-yoav16.vercel.app`) —
this URL is deterministic from the branch name alone and always points at that branch's
latest deployment, so there's no need to query Vercel to find it. Wait for the user's
explicit approval in chat before doing anything to `main`. On approval, merge the PR
(Vercel's Git integration then deploys to production automatically). On rejection, close
the PR and delete the branch (local and remote) rather than leaving it dangling.

**Vercel deployment:** production URL is **https://app-zeta-lovat-92.vercel.app** (Vercel project
`yoav16/app`). Since 2026-09-07 this deploys automatically via Vercel's Git integration — connected
to `yoavtzur/kitchen_app`, verified live end to end: a push to a feature branch produced its own
Preview deployment, and merging that branch into `main` produced a new Production deployment ~30s
later, with zero manual commands. No redeploy step is needed anymore after merging to `main` — the
manual command below is now only a fallback (e.g. deploying a local-only experiment that hasn't been
pushed, or if the Git integration is ever disconnected):

```bash
npx vercel@latest --token "$(cat "C:\Users\yoavt\.vercel-kitchen-app-token")" --yes --prod
```

Production also needs `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` set as Vercel env vars (done
2026-09-06 via `vercel env add ... production`) for the deployed build to run in Supabase sync mode
rather than local-only — see "Multi-device sync" below and the "Two modes, same app" note above.

## Architecture

### State: one reducer, either local or synced — `useApp()` never knows which

All app data is one `AppState` object (`src/types.ts`). Every screen reads it via `useApp()` and
dispatches actions defined in `src/store/reducer.ts` — there is no other source of truth, and the
reducer itself doesn't know or care whether it's running against local-only state or a synced
restaurant. `src/store/AppContext.tsx` picks between two backing stores (see "Multi-device sync"):
without Supabase configured, a plain `useReducer`-like local store persisted to `localStorage`
(`src/store/storage.ts`, key `kitchen-app-state`) — pixel-identical to how this app worked before
sync existed. With Supabase configured and the signed-in cook a member of a restaurant, a store
backed by that restaurant's op log instead.

`src/data/seed.ts` provides the initial state (used on first load, or when `localStorage` is empty/corrupt)
and defines `SCHEMA_VERSION`. **Bumping `SCHEMA_VERSION` wipes existing users' data unless you add a
migration** — `storage.ts` has a `migrateV1toV2` example to follow when the shape of `AppState` changes.

### The calc engine is the core logic — keep it pure

`src/lib/calc.ts` holds every quantity formula as a pure function taking plain data (never dispatch):
`requiredQty`, `toPrepare`, `recipeMultiplier`, `priorityFor`, `explodeIngredients` (recursive, cycle-guarded,
for recipes that consume other prepared products), `weightedRecipeItems`, `weeklyNeedForIngredient`,
`orderQtyForIngredient`, `daysOfSupply`. Screens and the reducer both call into this file rather than
duplicating math. When adding a new derived number, add it here and unit-test it in `calc.test.ts`.

### Auto tasks are computed live, not stored as snapshots

This is the least obvious part of the design. A daily prep task for a product with a recipe is **not**
a stored object — it's recomputed on every read by `getDisplayTasks` (`src/lib/tasks.ts`) from current
stock + recipe + settings via `calc.ts`. This means editing a product's current quantity anywhere in the
app immediately changes what tasks appear, with no "regenerate" step.

What *is* stored, per `(productId, date)`, is a small `AutoTaskOverride` (`state.taskOverrides`) holding
only what can't be recomputed: `dismissed`, `done` + `appliedCompletion` (the exact ingredient/product
deltas applied, so "undo" reverses precisely rather than recalculating), manual `priority` override, and
`assigneeId`. `autoTaskId(productId, date)` is the deterministic id tying override rows to the live product.

Manual tasks (`source: 'manual'`, added via the UI, optionally with no `recipeId` — a free-text task like
"clean shelves") are stored as ordinary `Task` objects in `state.tasks` and are not recomputed.

`getDisplayTasks` merges both kinds into one list. Any UI touching tasks should go through it rather than
reading `state.tasks` directly, and must branch on `task.source` when dispatching (`SET_TASK_PRIORITY` vs
`SET_AUTO_TASK_PRIORITY`, `DELETE_TASK` vs `DISMISS_AUTO_TASK`, `CONFIRM_TASK_COMPLETION` vs
`CONFIRM_AUTO_TASK_COMPLETION`, etc. — see `src/screens/tasks/TaskRow.tsx` and its sibling
`completeTask.ts`, which is the one function in the task UI that changes inventory).

### "Last edit wins" between the quantity editors and the Consumption screen

A product's "prep needed today" can come from either an automatic calculation or a manual override
entered on the Consumption screen (`DayPlan.entries[].prepOverride`, set via `SET_DAY_PLAN_ENTRY`).
Editing a product's current quantity anywhere (`SET_PRODUCT_QTY`) deliberately clears *today's*
override so the number recomputes — but leaves overrides for other (future-planned) dates untouched.
Both of these actions also clear a dismissed auto-task's `dismissed` flag for that date, so a task
hidden earlier reappears if the underlying need changes again. Preserve this behavior when touching
either action in `reducer.ts`.

### Recipes can consume other prepared products, recursively

A `RecipeItem.refType` is either `'ingredient'` (a raw purchased good) or `'product'` (another prepared
item that itself has a recipe — e.g. a pizza recipe consuming units of prepared dough). `explodeIngredients`
in `calc.ts` walks this recursively down to raw ingredients (with a `seenRecipeIds` cycle guard) for order
calculations; `weightedRecipeItems` gives the shallow, single-level scaled view used when displaying one
task's ingredient list.

### Multi-device sync (Supabase) — the reducer *is* the op log

The `Action` union in `reducer.ts` is already a serializable log of intents, and `reducer(state,
action)` is already an op interpreter — so syncing means shipping that log between devices, not
inventing a new protocol. Nothing about `calc.ts`, `tasks.ts`, or `integrity.ts` changed for this;
they're pure functions over `AppState` and don't care where it came from.

- **`src/sync/log.ts`** (pure) — `applyOps`, `applyPending`, `contiguousPrefix`, `foldContiguous`
  (gap-aware folding: applies the contiguous run of ops starting right after a known seq, reports
  a `gap` if some row is out of reach — the caller re-fetches rather than guessing).
- **`src/sync/engine.ts`** (pure) — `syncReduce(state, event) -> [state, effects]`: the entire
  protocol as one function. `SyncState` holds `confirmed` (server truth) + `pending` (locally
  dispatched, unconfirmed) + `display` (`confirmed` with `pending` replayed on top — what
  `useApp()` actually returns). A dispatch applies optimistically to `display` immediately;
  confirmation from the server drops it from `pending` and folds it into `confirmed`. State is
  **always eagerly compacted** — there is no separate `base`/`ops` pair to reason about, just
  `confirmed` + `confirmedSeq`, because re-deriving from a stored base would never buy anything a
  single client can't already get by folding once and discarding the op.
- **`src/sync/store.ts`** — the imperative shell. Runs the effects the pure engine asks for
  (`APPEND`, `FETCH_OPS`, `BOOTSTRAP`, `PERSIST`, `RETRY_IN`) against a `SyncAdapter`, exposes
  `subscribe`/`getState`/`getSyncInfo` for `useSyncExternalStore`. `getSyncStore(key, factory)` is
  a module-level singleton map — stores are created once per key and survive StrictMode's double
  render/effect invocation by construction, not by a `useEffect` guard. Also wires
  `online`/`offline`/`visibilitychange` → `ONLINE`/`OFFLINE`/`FOCUS` events, but **only in remote
  mode** (`kv`/`storageKey` present) — local mode has no network to reconnect to.
- **`src/sync/localAdapter.ts`** — a no-network "backend": holds `confirmed` + a seq counter in
  memory, writes through to the existing `kitchen-app-state` key via `saveState`. This is what
  local mode actually runs on, so the whole op pipeline is exercised by every user, not just
  synced ones.
- **`src/sync/supabaseAdapter.ts`** — the only file that imports `supabase-js` for data (not
  auth). `bootstrap` reads the restaurant's `snapshots` row plus any `ops` after it; `appendOps`
  calls the `append_ops` RPC; `subscribe` wires realtime on `ops` INSERT (new work) and
  `restaurants` UPDATE (a `snapshot_seq` bump — an import elsewhere moved the ground under us).
  **Realtime is a latency optimization only** — correctness comes from re-fetching
  `where seq > lastSeq`, which is exactly what a detected gap, a reconnect, or a tab regaining
  focus all trigger.

**Supabase schema**: `supabase/migrations/0001_init.sql` through
`0011_restaurant_owner.sql`, **applied by hand to the live project** (0007 is the
one to check first if account deletion, code rotation or join rate limiting misbehaves, 0008 for
invites, join requests and chef-only station edits, 0009 for phone numbers and the team's contact
list, 0010 for chef-only standing tasks, 0011 for several chefs with one owner — see LAUNCH-CHECKLIST.md). Nothing in the build applies migrations, so any *future*
migration needs the same manual step before synced clients can use it — until then they sit at
`upgrade-required` and refuse to append, which is the expected signal that it hasn't landed yet.
`LAUNCH-CHECKLIST.md` at the repo root is the operator-facing version of this.

Core tables: `restaurants` (name, `join_code`, `last_seq`, `snapshot_seq`), `snapshots` (the big jsonb
blob, kept off `restaurants` so that table stays realtime-cheap), `memberships` (`user_id` ⇄
`restaurant_id` ⇄ `cook_id` ⇄ role + permission flags, one restaurant per user in v1), `ops`
(append-only, `seq` allocated from `restaurants.last_seq` under a row lock inside `append_ops` —
**a per-restaurant contiguous sequence, not a `bigserial`**, because gap detection is meaningless over
a sequence with holes). Plus `app_config` (the kill switch, one row) and `scan_usage` (daily
counters; **RLS on with no policy and no grant at all**, so a client can neither read its own counter
nor reset it — the RPCs are the only reachable path). Despite the name `scan_usage` is now the
generic counter table: 0007 widened its `scope` check to carry join-attempt counters too, because
"count and judge atomically, per day, unreadable by the client" is the same problem twice.

Both foreign keys into `auth.users` (`ops.user_id`, `restaurants.created_by`) are `on delete set
null`, **not cascade** — see the block at the top of 0007. An op is the restaurant's data, so
cascading would delete a departing cook's contribution to a kitchen that is still running; what
is personal is the link to the person, and severing that is what erasure means here. Without the
rule at all, the database itself blocks account deletion, which is how it was until 0007.

RLS is SELECT-only everywhere; every write is a `SECURITY DEFINER` RPC (`create_restaurant`,
`join_restaurant`, `append_ops`, `set_my_cook`, `reset_snapshot`, `compact_snapshot`,
`set_member_permissions`, `remove_member`, `consume_scan_quota`, `rotate_join_code`,
`delete_my_account`), because RLS alone can't express "insert only once you're already a member",
"allocate the next seq under a lock", or "count and judge a quota atomically".

`scripts/{verify-supabase,check-ops,second-device-test,verify-remove-member,verify-scan-quota,verify-account-rpcs}.mjs`
are manual, throwaway verification tools against the live project — not part of the app or the
build. `scripts/{verify-a11y-ui,verify-auth-forms,verify-legal-and-account}.mjs` are the same idea
against a local dev server and a real browser instead (see "Commands" above).

**`scripts/verify-migrations-local.sh` is the one that runs before shipping a migration**, and it
exists because nothing else could: every other SQL check talks to the live project, so a migration
could only be tested *after* being pasted into the dashboard by hand. It spins up a throwaway
local PostgreSQL with a two-table stand-in for `auth`, applies all ten migrations in order, and
then exercises the RPCs. The property that makes it worth keeping is that **every RPC call is its
own `psql -c`, hence its own transaction**, exactly as PostgREST gives each call. Driving the same
functions from inside one `DO` block hides a whole class of bug, because an exception handler's
subtransaction rollback looks like success from outside — which is precisely how 0007's rate
limiter shipped in a commit while counting nothing at all. Add a case here for any new RPC that
writes and then decides.

### Nothing white-screens: boundaries, the route table, and scrubbed crash reports

`src/routes.tsx` holds the route table **as data** (`{ path, name, element, redirect? }[]`). `App.tsx`
maps it, so everything that has to happen per route — the error boundary, the `Suspense` fallback for
lazy screens — is written once instead of repeated across a dozen hand-written `<Route>` elements
where the next one gets added without it. `path="*"` lives here too.

`RouteBoundary` wraps **one route's element, never `<Routes>` itself**, and that distinction is the
whole design: `BottomNav` and `SyncBadge` are *siblings* of `<Routes>`, so they survive any screen's
crash automatically as long as the boundary stays below the router. A boundary around `<Routes>` would
leave the nav on screen with every tap landing on a dead tree — strictly worse than none. It passes
`pathname` as a reset key, so navigating away clears the error instead of sticking until a reload.
`CrashScreen` is the root fallback and **calls no app hook** (`useApp`/`useAuth`/`useSync` are exactly
what may have thrown), offering three reset tiers ordered by what they destroy — see
`src/lib/resetLocalData.ts`, which documents every `kitchen-*` localStorage key and what clearing it
costs.

**`src/lib/sentry.ts` is dormant without `VITE_SENTRY_DSN`**, and the scrubbing is the point rather
than an afterthought: *every* user-entered value in this app is Hebrew, so every Hebrew run is
replaced, along with the value Postgres quotes into a constraint violation (a live leak path —
`supabaseAdapter` builds it into `AppendError.message`, which `Settings` renders). Console breadcrumbs
are dropped outright, since one stray `console.log(action)` would ship a whole op. `extra` and
`contexts.state` are deleted structurally, not filtered — a denylist over a growing op log loses
eventually. SDK v11's `dataCollection` defaults are all `true` and all turned off here; the one that
matters most is `stackFrameVariables`, which captures local variable *values*, i.e. ingredients and
recipes. The single breadcrumb added on purpose is `action.type`, a closed enum with no user data,
recorded from `store.ts`'s `dispatch`; `sentry.test.ts` pins its shape so a payload can't be added
later.

### Closing `/api/scan-recipe` — the endpoint that costs money

The scan endpoint requires a Supabase access token and draws on a daily quota. `api/_auth.ts` forwards
the caller's own token to PostgREST with plain `fetch` (no supabase-js in the serverless bundle):
`consume_scan_quota()` verifies signature, membership **and** quota atomically in one round trip, which
is why the RPC *is* the authentication check rather than a separate `getUser()` call.

What actually bounds the cost, in order: **membership required** (signup is open and confirmation off,
so a valid JWT is worth nothing on its own — this makes the attack "obtain a join code"), then the
per-restaurant cap, then the global one, then the Google Cloud budget cap. The origin check stops a
malicious website and nothing scripted.

**A deliberate asymmetry, commented in both places:** `api/_auth.ts` **fails closed** (Supabase
unreachable → 503), because there a wrong answer costs money. `src/lib/appConfig.ts` **fails open**
(any failure → `null` → no restriction), because there a wrong answer is a stopped kitchen, which is
worse than the incident the switch exists to contain.

The whole request pipeline lives in `handleScanRequest` (`api/_gemini.ts`), shared by the Vercel
function and `vite.config.ts`'s dev middleware so the two cannot drift. Order matters: origin, method,
Content-Length, parse, mime/base64/size all run **with no network** before a quota unit is spent,
because there is deliberately no refund path.

### The kill switch — three tiers, changed from the dashboard with no deploy

`app_config` is one row, readable by `anon` as well as `authenticated` (a kill switch has to reach a
client whose *auth path* is the broken thing) and writable by nobody — no write policy, no write
grant. `src/lib/appConfig.ts` polls it at mount, on focus (throttled) and every 15 min.

1. `maintenance_mode` → `MaintenanceGate` in `Gate.tsx`, placed **above `AppProvider`**, so no sync
   store is ever constructed and not one op can be dispatched. A check inside `maybeAppend` could only
   stop ops being *sent* — a cook would keep "completing" tasks into a queue that will never drain.
2. `read_only_mode`, or a build below `min_client_version` → the sticky `'read-only'` sync status.
   It reuses `upgrade-required`'s *mechanism* but not its *value*: that one renders "refresh the app",
   which during a maintenance window is a lie and trains cooks to ignore the one message that means it.
   `isBlocked(status)` in `engine.ts` is the shared predicate for both.
3. Otherwise normal.

`min_client_version` does nothing until `VITE_APP_VERSION` carries a numeric version; `isClientOutdated`
never locks out a version it cannot parse, including the default `dev`.

### Erasure, a rotatable key, and a ceiling on guessing

Three things migration 0007 adds, each closing a hole that had no workaround at all.

**`delete_my_account()`** is one RPC and one transaction, not an Edge Function — the plan called
for one, but everything it needed turned out to be reachable from SQL, so there is no second
deploy path and no CLI dependency. Three cases: not a member → just the account; the last member
of a restaurant → the restaurant goes too (snapshots and ops cascade from `restaurants`); a chef
with teammates and no other chef → **refused**, because deleting there leaves a working kitchen
nobody can administer and there is no server-side way to appoint a replacement. That refusal is
the one case where an account is not immediately erasable, and it is resolvable by the user in
two taps, which is what makes it defensible rather than a refusal to comply. The final `delete
from auth.users` is what makes it real rather than a soft delete; it works because a SECURITY
DEFINER function created from the SQL editor is owned by `postgres`, and if a project ever locks
that down the whole transaction rolls back rather than half-deleting.

Client side, `AuthContext.deleteMyAccount` follows the RPC with `fullReset(signOut)` — the same
tier-3 wipe `CrashScreen` offers — which ends in a reload. Nothing after that line runs, and
nothing needs to: there is no session left to render a signed-in state from.

**`rotate_join_code()`** exists because the join code *is* the key to a kitchen and was fixed for
the life of the restaurant. A cook who leaves keeps a working key; a code read aloud in a busy
room stays valid forever. Chef-only, takes no restaurant id (it acts on the caller's own
membership, so there is nothing to lie about), and the old code stops working the instant it
returns.

**Join-attempt limiting** reuses `scan_usage` with two new scopes, and the asymmetry between
them is the design: *every* attempt bumps the per-account counter, but only a **failed** attempt
bumps the global one, and the global ceiling is therefore consulted only on a lookup that already
missed. So a correct code always works no matter how full the global bucket is. Without that
split, a global limit is a denial-of-service switch anyone can flip — exhaust it with garbage and
nobody in any restaurant can join for the rest of the day. The per-account limit alone bounds
nothing, because signup is open and an attacker mints a fresh account every ten guesses; the
global counter is the real ceiling, and the split is what makes it safe to set low.

**`join_restaurant` therefore reports a refusal in a `status` column rather than raising**, and
that is the single most important thing to preserve about it. The first version raised
`invalid_code` / `too_many_join_attempts`, and **RAISE aborts the transaction — rolling back the
counter bump the refusal was based on**. Counting before judging buys nothing if judging erases
the count: measured against a real database, every failed guess left `scan_usage` exactly as it
found it, `join_global` never got a single row, and the limit never fired however many times it
was called. It compiled, it read correctly, and it was decoration. `consume_scan_quota()` in 0006
already had this right — it *returns* `{"status":"quota"}` — and that precedent is the one to
follow for anything that must both record an attempt and refuse it. Raising is still correct for
"not authenticated", where nothing has been written and a rollback loses nothing. Client side,
`mapJoinStatus` (`lib/rpcErrors.ts`, since replaced by `mapRequestJoinStatus` for the 0008 flow — same rule) turns the status into Hebrew and treats an **unrecognised**
status as a refusal, because reading it as success would cache a membership with a null
restaurant id.

**Turnstile** (`src/lib/turnstile.ts`, `src/components/Turnstile.tsx`) is **dormant without
`VITE_TURNSTILE_SITE_KEY`**, the same shape as `sentry.ts` without a DSN. It attacks the problem
`api/_auth.ts` documents — "a valid JWT is worth nothing on its own" — one step earlier, by making
the JWT cost something. Three things about it are load-bearing: Supabase's CAPTCHA setting is
**not per-endpoint**, so sign-up, sign-in *and* password reset all pass a token or all break
together; a token is **single use and is spent on a rejected attempt**, so every caller bumps
`resetKey` after a failure or the second error message is always the wrong one; and a challenge
that fails to load sends no token rather than blocking submit, because a CAPTCHA that cannot load
must not be a lock on the door — the people it keeps out are the staff.

### Importing a backup is the most destructive path in the app

In local mode it replaces the browser's entire state. In remote mode `Settings` hands the result
straight to `reset_snapshot`, which replaces **the whole restaurant for every device at once**,
with no undo. `parseImportedState` used to recognise schema versions 1 to 4 and *fall through to
`return parsed` for everything else* — so `{"schemaVersion":5}`, a two-field file, "imported
successfully" and wiped a kitchen, after which every screen crashed on `state.ingredients.map`.

`src/store/importValidation.ts` holds the two rules that follow, and they are the whole design:

- **Nothing is trusted because it has a version number.** The version chooses which migration
  chain runs and is never on its own a reason to accept the file; what the chain *produces* is
  validated, so a bad file is caught once at the end no matter which path it took. A version
  above `SCHEMA_VERSION` is refused outright — it is a backup from a newer app, so its shape is by
  definition one this code does not know.
- **Reject, never repair.** A partially-understood backup is silently deleted data, which is the
  failure this module exists to prevent. The single exception is `settings`, filled field by field
  from the seed defaults, because every setting has a meaningful default and an ingredient does
  not.

`migrateToCurrent` in `storage.ts` is now shared by `loadState` and the importer, and returns
`null` for an unrecognised version rather than the input — there is no path through it that hands
back something it did not migrate. That duplication is how the bug happened: the importer carried
its own copy of the ladder, and its copy ended in `return parsed`.

`parseImportedState` returns a result rather than throwing, because the caller has something to do
with both outcomes: a failure is a Hebrew sentence naming the field, and a success carries the
counts the confirm dialog shows before anything is replaced. There was no confirmation at all
before — pick a file, lose a restaurant.

### Auth and onboarding — a render gate, not a route

`src/auth/AuthContext.tsx` wraps Supabase auth (session) and the caller's `memberships` row
(restaurant + cook + role), with `src/auth/authCache.ts` caching the latter in `localStorage` so a
lost network mid-shift doesn't bounce a cook back to onboarding — a stored session/membership is
authoritative until an explicit `SIGNED_OUT`. `src/components/Gate.tsx` (`AuthGate`,
`MembershipGate`) wraps the app in `App.tsx`, rendering `Auth.tsx`/`Onboarding.tsx` in place of
the app rather than redirecting — there's no URL to bypass, and `BottomNav` never flashes. Every
gate calls `useAuth()` unconditionally, branching on `isSupabaseConfigured` (`src/lib/supabase.ts`)
*after* the hook call, so hook order never depends on it — in local mode `AuthProvider` is still
mounted (needed for `useAuth()` to be callable at all) but stays fully inert.

`isSupabaseConfigured` is `false` whenever `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset,
**or** `localStorage['kitchen-force-local'] === '1'` — a deliberate escape hatch to exercise local
mode on an otherwise-configured build without touching env vars.

### Screens and navigation

`src/App.tsx` nests, outermost to innermost: `HashRouter` (works from a `file://`/static host with
no server routing) → `AuthProvider` → `.app-shell` (with `UpdatePrompt` **outside every gate** — a
cook stuck behind a broken bundle on the sign-in screen is exactly who needs it) → `.app-main` →
`Routes`. That `<Routes>` has two kinds of child:

- **`LEGAL_ROUTES`**, declared first and rendered with no gate above them at all. A privacy
  notice a person can only read after creating the account is given after the processing it
  describes began, so `/legal/privacy` and `/legal/terms` have to sit outside `AuthGate`. `Auth.tsx`
  links to them, and `verify-legal-and-account.mjs` proves they render with no session.
- **`APP_ROUTES`**, under a **pathless layout route** whose element is the gate stack:
  `AuthGate` → `MembershipGate` → `MaintenanceGate` → `AppProvider` → `CookGate` →
  `SentryContext` + `SyncBadge` + `<Outlet />` + `BottomNav`.

`<Outlet />` sits exactly where `<Routes>` used to, which is what preserves both of the old
shape's properties: `BottomNav` and `SyncBadge` are still *siblings* of the thing that swaps per
route, so a route boundary can never take them down; and the whole stack — `AppProvider` included
— stays mounted across navigations. A per-route wrapper would have remounted it on every tap,
which is the failure the browser check pins by DOM node identity rather than by reading the code.

Screens live flat in `src/screens/` (app screens plus `Auth.tsx`/`Onboarding.tsx`), except the task UI,
which is split under `src/screens/tasks/` (`TaskRow`, `AssigneeChip`, `TaskMenuSheet`, `TaskDetailSheet`,
`AddManualTaskSheet`, `QuickActionsSheet`, `completeTask`). Shared UI lives in `src/components/`. Every screen except `Today` is lazily loaded via
`src/routes.tsx`; `Today` stays eager because it is the PWA's `start_url` and the target of the `/`
redirect.

**`Today.tsx` is the landing screen and the whole core loop.** It replaced Home and Tasks, which were
two screens showing the same list — Home was read-only and every card on it merely navigated to Tasks,
so a cook saw their work twice before touching it once. `/` redirects to `/tasks` (same pattern
`/ingredients` → `/count` already used), which also retires the `NavLink to="/" end` footgun.

**`BottomNav` is role-based** — `navTabsFor(role)` in `src/lib/nav.ts` (pure, tested) is the one place
that decides what each role sees. A **chef** gets משימות (open-task badge) · מלאי (`/count`) ·
הזמנות · צריכה · תפריט; a **cook** gets משימות · מתכונים · מלאי · תפריט. The cook keeps a תפריט tab on
purpose: sign-out and account deletion live behind it, and migration 0007's erasure right is not a
chef-only right. `/orders`, `/consumption` and `/stations` are wrapped in `ChefRoute`, so a cook who
types the URL lands on `/tasks`. **All of that is presentation** — the boundary is still `append_ops`.
`/morning` redirects to `/orders` and `/more` to `/menu`. `isTabActive` keeps תפריט lit on the screens
it opens (`/recipes`, `/settings`, `/stations`). `StockCount.tsx` is both the ingredient database and
the stock-count walk-through; there is no separate `/ingredients` screen.

In local mode there are no accounts and `usePermissions` makes everyone a chef, so **the cook's view
can only be checked against a real cook account** (in a preview) — `nav.test.ts` covers the logic,
nothing local covers the rendering.

**Grouping vs. filtering on `Today`** — the same shape `Recipes.tsx` uses, so it is one pattern used
twice rather than two to learn. Tab "הכל" renders station groups with headings; a single station tab
renders a flat list with **no** heading (the active tab *is* the heading); searching renders flat with
tabs hidden. They are never redundant, because a heading and the active tab never name the same
station at once.

`getDisplayTasks` returns `[...auto, ...manual]` **unsorted and ungrouped**. `taskProgress`,
`sortDisplayTasks` and `groupByStation` (`src/lib/tasks.ts`) are the only place that decides how a task
list is counted, ordered and grouped — the screen and the nav badge both go through them, so they can
never show two different numbers for the same day. `taskProgress(...).ratio` is exactly `1` when
`total === 0`: "nothing to do" must read as complete, where a naive `done / total` gives `NaN`.

**The task list is rows, not cards (2026-10-02, no migration).** The first task used to start about 43%
of the way down a phone, below a title, a progress bar, a date and add row, a search box and the tabs;
it now starts around 24%. What changed, and why each is the way it is:

- **Header** is the restaurant name, the date, and three 44px icons (search, date, print). Search
  opens on demand (`searchOpen`, closed again by the same button, which also clears the query). The
  date is a real `<input type="date">` laid invisibly over the calendar icon, so the platform's own
  picker opens; because the date is no longer visible text-in-a-field, a day other than today shows a
  `.day-banner` with "חזרה להיום". The decorative blobs and mascot are gone (they overlapped the
  subtitle and carried no information).
- **Station tabs exist only once the kitchen has a station** (`showStationTabs`), and with the tabs
  hidden the shown filter is forced to "הכל" (a stored station must not filter a list with no tabs
  to undo it). A heading over the only group is dropped (`showStationHeadings`). "משימות שהושלמו לפי
  טבח" waits for the first completion (`showCookCompletions`). All four are pure, in `lib/taskRow.ts`.
- **"+ משימה" is a floating button** (`.fab-bar`) at the *end* edge, because `.sync-badge` is at the
  start edge on the same row and the sync pill (stuck, error, read-only) is the one that asks a person
  to act. The one thing it can sit under is `.update-prompt` (same edge, higher z-index), which is rare
  and dismissable. `.fab-spacer` keeps the last row scrollable clear of it.
- **Priority is said twice, not four times:** a 4px stripe on the row's start edge (colour) and
  `PriorityChip` (dot + word, a real button that cycles it) under the title. The pulsing dot, the 3px
  glowing border and the pill are gone. The red *outline* (`.task-row.critical`) now means only "an
  ingredient is missing", so the two reds no longer share a mechanism.
- **Who has it** is `AssigneeChip`: a 44px circle with the cook's initial, and a real `<select>` laid
  invisibly over it. The name also shows in the meta line, in the cook's colour, which is what prints.
- **Removing a task is behind "⋯"** (`TaskMenuSheet`), two taps instead of a ✕ beside the completion
  box. The same sheet is the button route to the left-swipe quick actions and to the recipe detail,
  because a gesture alone is unreachable by keyboard and screen reader, the problem the checkbox already
  had. Removal itself is unchanged: it dispatches immediately, with no undo.
- `.tasks-grid` is one column on a phone, two from 768px, three from 1024px. The "lone last card spans
  the row" rule is gone with the cards.
- Print: `.task-row` joins `.card` in the black-on-white block, the stripe and outline are hidden, and
  the meta line is forced black. The checkbox rules are untouched.

**Completion is reachable without a touchscreen.** `SwipeToComplete` listens for touch events only and
its reveal panel is `aria-hidden`, so the app's single core action used to be unreachable by mouse,
keyboard and screen reader. `TaskRow` promotes the decorative print-only box already in that slot to a
real `role="checkbox"`. Two traps live there and are commented in place: it must **not** carry `btn`
(`@media print` hides `.btn !important`, so the printed prep list would have no boxes to tick, and
nobody notices until it is on paper), and it must declare its own `display` (it also carries
`print-check`, which is `display: none` on screen). `SwipeToComplete` swallows the synthetic click a
touch sequence fires afterwards, or a swipe ending over that checkbox would mark and unmark in one
gesture.

Editing UI follows one recurring pattern: tap a value to open a `BottomSheet` containing a `NumberEditor`
or form, dispatch on save. Look at `src/screens/StockCount.tsx` or `Consumption.tsx` before inventing a
new editing pattern.

`StockCount.tsx` mixes two commit models on one screen, deliberately: the ספירה column is a draft,
batched across every ingredient and product and committed as one `BULK_UPDATE_QUANTITIES` from the
save bar, while everything inside an ingredient's detail sheet (name, supplier, usage, par, unit,
delete) dispatches immediately. Tapping an ingredient's name flushes that one row's pending draft as
a single-item `BULK_UPDATE_QUANTITIES` before opening the sheet, so the sheet always shows committed
truth — otherwise a unit change made inside the sheet would silently reinterpret a draft quantity
still typed in the old unit.

### `BottomSheet` is a real dialog, and sheets nest

Every editing surface in this app is a `BottomSheet`, so everything true of dialogs is true of it
exactly once: `role="dialog"`, `aria-modal`, `aria-labelledby` wired to its own title, `Escape` to
close, `body` scroll-locked behind it, focus moved in on open and handed back to the control that
opened it on close.

**The part that isn't boilerplate is that sheets nest.** `RecipeEditor`'s edit sheet opens a
`ConfirmDialog` — itself a `BottomSheet` — over itself, `StockCount`'s ingredient sheet opens two,
and a `NumberEditor` anywhere inside any sheet opens another. Written naively, every one of those
pairs breaks the same way: one `Escape` closes both, and the outer focus trap fights the inner one
for focus. So `BottomSheet` keeps a module-level stack and gates both behaviours on *being the
topmost sheet*, not on being a sheet. The scroll lock is stack-scoped for the same reason, and the
value to restore is saved when the stack goes empty → 1 rather than per instance — a sheet saving
what it happened to see on mount saves `'hidden'` whenever another is already open, and two
sheets closed in the wrong order would leave the page permanently unable to scroll.

The trap's actual decision lives in `src/lib/focusTrap.ts` as `nextFocusTarget(ring, active,
shiftKey)`, a pure function returning `null` for "let the browser do what it would anyway" — only
the two ends of the ring need intercepting, and re-implementing forward tabbing would mean
re-deriving the browser's own order and getting it subtly wrong in the middle. Splitting it out is
what makes a focus trap testable at all under this repo's no-jsdom rule: the component keeps only
the parts that genuinely need a browser (querying candidates, reading `activeElement`, calling
`.focus()`).

### Transient confirmations: one timer hook, one `Toast`

Seven screens had grown their own `useState` + bare `setTimeout` for "הועתק ✓" / "נשמר ✓", and all
seven shared two bugs: the timer was never cleared on unmount, and triggering twice in quick
succession left the first timer running to switch the flag off mid-way through the second message.
`src/lib/useTimedFlag.ts` (`useTimedFlag`, `useTimedMessage`) owns the timer once. It imports
nothing but React on purpose — `CrashScreen` uses it, and `CrashScreen` must call no app hook.

There are deliberately **two shapes**, not one:

- **A label swap**, where the confirmation replaces the text of the button just pressed (`Orders`'s
  copy and submit, `Settings`'s join-code pill, `CrashScreen`'s crash id). The answer belongs where
  the tap was; a floating message would be strictly worse.
- **`components/Toast.tsx`**, fixed above the nav, for confirmations with no button to live in
  (`StockCount`, the morning order, `Settings`'s member removal). These used to render in document
  flow — on `StockCount` that put "הספירה נשמרה ✓" *below a full ingredient table*, off the bottom
  of the document, where the cook who just tapped the sticky save bar never saw it. `role="status"`
  because a message that appears silently and removes itself is invisible to a screen reader, and
  "did that save?" is the question it exists to answer.

The strip above the bottom nav now holds three things — `.sync-badge` (start edge), `.count-save-bar`
(centered) and `.toast`. The toast clears the save bar rather than sitting beside it, because on both
screens that render one the two are driven by the same tap: the bar is the control, the toast is its
answer, and a toast drawn over it would cover what it is confirming. `--save-bar-height` in
`tokens.css` is what keeps those two rules agreeing.

### Orders, stock tabs, stations, the quiet sync dot (2026-10-01)

**Orders is one screen with three views** (`components/Segmented.tsx`): **בוקר** (default) · לפי ספק ·
היסטוריה. The morning view (`screens/orders/MorningOrder.tsx`) replaced the card-per-ingredient
`MorningDashboard`: one ~56px row per ingredient, the **order** box at the far edge (bold) and the
**count** box beside it (muted), the unit in the sub-line instead of a label, a coloured dot only when
stock is low (`lowStockTone`), and an (i) sheet for days-of-supply / weekend forecast / par level.
Everything arithmetic is in `src/lib/orders.ts` (`suggestedQty`, `buildOrderLines`, `planFillToPar`),
tested. Two things worth keeping true:

- **The approve button is enabled by exactly one thing: the order has lines** (`buildOrderLines` is
  non-empty). It used to be `changedCounts.length === 0`, so a correct suggestion could not be sent
  without a made-up edit. `approve()` already only dispatched `SUBMIT_ORDER` when no count changed.
- **"מלא לפי המינימום" clears hand-typed quantities back to the automatic suggestion** (max of weekly
  need and par, minus stock), with undo in the toast. It skips lines already `ordered`: that quantity
  is what went to the supplier, not a draft. The order box commits on blur/Enter, not per keystroke —
  each commit is an op.

**`StockCount`** has an ingredients | products switch. Ingredients get sticky, dynamic category tabs
(`lib/ingredientCategories.ts`: "הכל" first, a category only while an ingredient carries it, "ללא
קטגוריה" last and only if used); products get tabs by **station** (a product's station is its
recipe's `category`, `productStation`). Ingredient `category` is still free text, so the edit field has a
`<datalist>` and `normalizeCategory` folds spacing/case onto the existing spelling — it deliberately
does **not** merge "ירק" with "ירקות". For a cook the screen is count-only: no add, no detail sheet.

**Stations** (`screens/Stations.tsx`, chef only, reached from תפריט): add, rename, delete behind an
"עריכה" toggle — never a swipe. `RENAME_STATION` and `DELETE_STATION` (`reducer.ts`) re-point
`recipe.category` and free-text `task.categoryOverride` to the chosen station or `'general'`; because
auto-tasks derive from the recipe, that *is* moving the day's prep list. Both are idempotent under
replay and chef-only in `append_ops` (migration 0008 added a `'chef'` kind to `action_requires`, which
returns null — open to anyone — for every action it does not list).

**Sync chrome is split by whether a person must act.** `syncIndicator()` (`lib/syncIndicator.ts`, pure):
offline/pending is a quiet **dot** beside the screen title (`SyncDot` inside `ScreenHeader` — grey =
offline with nothing waiting, amber = something waiting, never red), and only refresh / stuck / error /
read-only stay a **pill with words** (`SyncBadge`). That is the walk-in rule: no signal is a fact, not
an alarm. After a save with no connection the toast says "נשמר במכשיר, יסונכרן כשתחזור קליטה"
(`savedMessage`). Local mode renders neither.

**Design language** (Tabit Shift, structure not palette — the neon green stays): `--row-height` /
`--btn-height` 56px, `.btn-block` full-width actions, `.list-card` + `.menu-row` for lists, `.segmented`,
`.sticky-tabs`, `.dot`. Red/yellow/green remain safety/status signals.

### Joining a kitchen: invite link → request → chef approval (migration 0008)

Anyone holding the six-character code used to be a member instantly. Now **every** join — by code or by
a chef's one-time link — is a *request* a chef approves. The shape is dictated by one fact:
`is_member()` (hence every RLS policy and `append_ops`) treats a `memberships` row as full access, so a
"pending" person **must not be a membership row**. They live in `join_requests`, which has RLS on and
no policy and no grant (like `scan_usage`), and become a membership only in `resolve_join_request`.

- **Chef:** Settings → "הזמן טבח" → `create_invite()` returns a 32-hex token **once** (only its SHA-256
  is stored; 72h; one use) → `InviteCookSheet` ("שתף בוואטסאפ" / copy). `JoinRequestsBanner` (top of
  `Today` and in the team section) shows "{שם} מבקש/ת להצטרף [אשר] [דחה]"; `useJoinRequests` polls
  (mount, focus, 60s) — no realtime, per the project rule that realtime is only a latency optimisation.
  Approve = `ADD_COOK` op first, then `resolve_join_request(user, true, cookId)`; on failure the cook row
  is withdrawn. That binding is why an approved cook skips the "who am I" screen.
- **Cook:** `#/join/<token>` (`INVITE_ROUTES`, above every gate like the legal routes) banks the token in
  `kitchen-pending-invite` and redirects; `Auth` starts on sign-up, `Onboarding` shows first / last /
  phone (optional) and calls `request_join`. Then `MembershipGate` shows `PendingApproval` (polls
  `my_join_status` every 10s and on focus — a pending person can't use realtime, which rides on the
  RLS that keeps them out) or `JoinRejected`.
- **`request_join` returns a `status` instead of raising**, for the 0007 reason: `RAISE` rolls back the
  counter bump the refusal was based on. Same two counters and asymmetry (only a failed lookup spends
  the global one, so a live invite or correct code works with the bucket full). An invite is claimed
  only after every check that could still refuse, so a refusal never burns a link. A cap of 20 waiting
  requests per kitchen stops anyone who has seen the code from burying the chef's banner.
- The old `join_restaurant` is kept as a **refusal** (`approval_required`), not dropped: left alone it
  would let a stale cached client turn a code into instant membership, around the approval.
- A four-digit personal passcode was requested and **not built**: Supabase requires 6+ character
  passwords and four digits is 10,000 guesses. Cooks still use email + password.
- The privacy notice and terms (`Legal.tsx`) describe the name/phone request data; keep them in step.

### Menu, profile, team — and where a phone number lives (migration 0009)

**Settings used to show the team twice** — "הרשאות צוות" (accounts) and "טבחים" (`Cook` rows) — because
they are two tables underneath and one list to the person looking. `screens/Team.tsx` is now the one
place: every account with its cook, then "טבחים ללא חשבון". `useTeamMembers` (`auth/`) is the shared
`memberships` fetch (Team renders the list; Settings only needs the headcount for the deletion warning).
Until the member list has loaded, the accountless section is **withheld** — every cook looks accountless
on a guess, and "accountless" is what unlocks a one-tap delete. Local mode has no accounts, so Team there
is just the cooks. A chef sees everyone (role, phone, e-mail, permissions, remove) plus invite and
approve; a cook sees the chef's phone with call / WhatsApp links (`ContactActions`, `lib/phone.ts`).

**`screens/Profile.tsx`** (profile card on the menu): name, phone, e-mail, password. The name is the
`Cook` row, so it saves as an ordinary op (`RENAME_COOK`, a silent no-op on blank/unknown/unchanged for
the usual replay reason). The e-mail and password go to Supabase auth (`updateEmail` takes effect only
after the confirmation mail, so `session.user.email` keeps the old address until then). **A failed load
of the stored phone locks the field** rather than showing it blank — saving "nothing" would delete a
real number.

**Phone numbers: `member_contacts`, not a column on `memberships`.** `memberships_read` lets every
teammate read every membership row, which is right for role and cook binding and wrong for a phone
number. The table has RLS on and no policy/grant (like `scan_usage` and `join_requests`); the RPCs
`get_my_phone` / `set_my_phone` / `list_team_contacts` decide who sees what — a chef reads everyone's
phone **and e-mail**, a cook reads only the chefs' phones, never an e-mail. 0009 also redefines
`resolve_join_request` so the number typed when asking to join survives approval (0008 deleted it with
the request), and a trigger drops a contact row with its membership. Both foreign keys **cascade** —
this is personal data, unlike `ops`, which is the restaurant's record. `Legal.tsx` describes it; keep
them in step. Without the migration the app degrades rather than breaks: saving a phone reports "not
available on the server yet", and Team renders without the phone line.

**Menu** is role-based as before; it now also carries "צוות" for both roles and links the profile card
to `/profile` (a plain card in local mode, where there is no account to show).

**`PasswordField`** is the one password input (sign-in, new password, change password): the eye is a real
`type="button"` with `aria-pressed`, and `onPointerDown` is prevented so tapping it does not dismiss the
phone keyboard. `name`/`autoComplete` pass straight through — password managers key off those, not the
input's `type`.

**The task list remembers its station tab** (`lib/todayFilter.ts`, key `kitchen-today-station`):
`Today` unmounts on every navigation, so `useState('all')` reset it each time. It is a device preference,
so it lives in `localStorage`, not the synced state (which would flip every other cook's tab). A stored
station that no longer exists resolves to "הכל" without being overwritten. The date input is `.date-chip`,
deliberately the quietest control on the screen.

**Tap feel.** `html { touch-action: manipulation }` (no double-tap-zoom wait, applied to everything
rather than three opt-in controls), instant `:active` states at the bottom of `global.css` (the app turns
off the browser's tap flash, so a control with no `:active` rule gave *no* feedback until the screen
changed), no transition on the nav icon, and `preloadScreens()` in `routes.tsx` warms every lazy chunk
at idle so the first visit to a tab is not a network round trip.

### Swipe quick actions, receiving, one undo, recipe-change gate (2026-10-01, no migration)

None of this needed a migration: every new piece of state is an **optional field** on `AppState`
(`Ingredient.shortFlag`, `OrderLine.receivedQty`, `AppState.recipeNotices`), so no `SCHEMA_VERSION` bump,
and an older client simply ignores the new action types (`default: return state`).

**Task cards.** Swipe **right** = done (green), swipe **left** = `QuickActionsSheet` (orange): "חסר חומר
גלם" flags an ingredient (`SET_INGREDIENT_SHORT`, absolute) and "פחת" takes ¼ / ½ / הכל off stock
(`SET_INGREDIENT_QTY`) — nothing to type, each ends in "בטל". `swipeDirection` is physical (right is right
in RTL too). Left springs the card back; the sheet is rendered **inside** the card, because a sibling of
the swipe wrapper becomes a second child of `.tasks-grid`, a phantom cell in the list (found live, not by
a test). The same sheet is reachable from the row's "⋯" menu. Finished tasks leave the working list for a collapsed "הושלמו (N)" —
still counted in the progress bar, still one swipe from undone (`UNDO_*_COMPLETION` replays the stored
`appliedCompletion`, so stock returns exactly). `shortFlag` is cleared by stock going *up* (`withQty` in
`reducer.ts`: a count, a delivery) and not by going down (a waste report). It reaches the morning order
through `suggestedQty` (par level, else a day of cover, else 1) and shows as a red dot.

**The urgency control is a chip, never next to the done-checkbox.** It used to be a bare 14px dot beside the
checkbox, and a thumb aiming at one hit the other — a wrong "done" moves stock. `PriorityChip` (dot + word, one
button, 44px hit area) sits in the meta line *under* the title, with the checkbox alone at the start edge. The
title is 18px on purpose (read at arm's length over a hot pass); keep it when restyling the row.

**Tasks missing an ingredient jump the queue.** `blockedIngredients` (`lib/tasks.ts`) compares what the
multiplier needs with stock *in the ingredient's own unit* (a cross-family line is skipped, not guessed)
and counts `shortFlag`. `DisplayTask.blocked` is absent when nothing is missing and always absent on a
finished task; `sortDisplayTasks` is done → blocked → priority → id. A red outline (`.task-row.critical`)
sits on top of the priority stripe: priority is about the product's stock, this is about its ingredients.

**One shared "בטל"** (`UndoProvider`, `lib/undo.ts`, 4s) replaces "are you sure?" for cook / station /
recipe / ingredient deletes and fill-to-par. It sits above `<Outlet />` and inside `AppProvider` because
the sheet that triggered a delete closes itself, and a toast rendered inside it would leave with it.
`deleteWithUndo(action, message)` computes the *after* state by calling the pure reducer, diffs it
(`lib/restore.ts`, `diffForRestore`) and undoes with `RESTORE_ENTITIES`, an idempotent upsert of the
**before** version of everything the deletion touched — needed because `DELETE_RECIPE` and
`DELETE_INGREDIENT` cascade through `pruneEntities` into products, tasks, plans and order lines. Known
cost: an edit to those same entities from another device inside the 4s window is overwritten. **Still
confirmed** (irreversible or an RPC): account deletion, backup import, join-code rotation, removing a
member, local resets, and the unit-change warning (information, not a guard). The station delete keeps
its sheet because it asks *where the recipes go* — that is a choice, not a confirmation.

**Receiving** (`screens/Receiving.tsx`, chef only, `/receiving`, linked from the menu and the orders
tab). Lines keep a `receivedQty` instead of being deleted, and `SET_LINE_RECEIVED` is **absolute**: stock
moves by the *difference* from what was recorded, so replay, a double tap and undo are all exact — the
old `RECEIVE_ORDER` deleted the line and could not represent a short delivery (it is still in the reducer
for old ops). Tap = arrived in full, long press = `QtySheet` (the keypad extracted from `NumberEditor`)
for the real quantity; a short delivery stays open as "התקבל 3 · חסר 2". `useLongPress` keeps the tap a
real `click` (keyboard still works) and swallows the click that follows a long press; the context menu is
blocked. The window is `RECEIVING_WINDOW_DAYS` (7).

**Morning order by supplier.** `groupBySupplier` / `supplierMessages` (`lib/orders.ts`) build one WhatsApp
message per supplier from the exact lines submitted; `SendOrdersSheet` follows "אשר הכל". The by-supplier
orders view now reads `suggestedQty` instead of its own copy of the calculation. An ingredient carries
only a supplier *name*, so WhatsApp opens with the text filled in and the chef picks the contact.

**"קראתי והבנתי" gate (`NoticeGate`, `lib/notices.ts`).** A notice is **derived, never authored**: saving
a recipe whose *content* changed (name, items, steps, yield — not its station) bumps a per-recipe `rev`
in `recipeNotices` and records who has read it. The author is pre-acknowledged (`byCookId` on
`UPDATE_RECIPE` / `SAVE_PREP_ITEM`); a cook approved later starts caught up (`ADD_COOK`). It is
deterministic (no clock, no random id), and needs no server rule — editing is already `can_edit_recipes`
and acknowledging is open to any member. An acknowledgement names the revision read, so a later edit makes
the notice pending again. The gate wraps the **whole layout** (nav included, otherwise it can be walked
around), shows for a signed-in `cook` only (a chef made the change; local mode has no cooks), and sits
after `CookGate`. The server does not check that an ACK's `cookId` is the caller's own — the same trust
model as every other op that names a cook.

### A new day: unfinished work carries over (2026-10-01, no migration)

**What used to happen.** An auto task is recomputed from stock, so an undone one came back on its own — but
what is stored per `(product, date)` (assignee, hand-set priority, dismissal) did not. And a *manual* task
vanished: the list shows `task.date === date`, so yesterday's open "clean shelves" was still in the data and
nowhere on screen (no overdue marker, not in the nav badge).

**`CARRY_OVER_TASKS { today }`** (`lib/carryOver.ts`, pure, idempotent — it returns the *same object* when
there is nothing to do, which is also how callers ask "is there anything to do?"). A real action rather
than a display-time derivation, because a manual task moved onto today is then an ordinary task of today:
completing it, the per-cook "done today" count and every card action work unchanged (a derived version
would file a task finished today under yesterday). Open manual tasks move to `today` and keep the day they
were *first* planned for in `Task.carriedFrom` (so "3 days ago" does not reset each morning); there is no
age limit — they stay until done or deleted, with "מלפני N ימים" on the card. For auto tasks only the
**most recent earlier** override per product is considered, and only its assignee and a hand-set priority
are copied, and only if it was neither done (the work happened) nor **dismissed** (a real need must not stay
hidden forever because it was waved away once), within `AUTO_CARRY_DAYS` (7), and never over an existing row
for today. `today` comes from the dispatcher, never the clock, so replay agrees on every device.

**`DayRollover`** (`components/`, in `GatedApp` beside `SentryContext`) sends it, and **at the layout
level, not on `Today`**: the open-task badge in the bottom nav counts the same list and has to be right on
whichever screen the app lands on. Several devices opening in the same minute is fine — the first makes the
rest no-ops. **`useToday`** keeps "today" current (visibility/focus, and the next local midnight rescheduled
from the real clock rather than a fixed 24h, so a device that slept through midnight lands on the right day
when it wakes): `Today` follows it until the cook picks another date, and `BottomNav` uses it instead of a
`todayStr()` read once inside a memo, which went stale on an app left open overnight. Known edge: a device
whose clock runs ahead carries tasks onto a date other devices have not reached yet.

### Standing tasks: "clean the shelves" every day (2026-10-01, migration 0010 optional)

**A rule, not a task.** `RecurringTask` (`AppState.recurringTasks?`, optional — no schema bump) holds a
title, the weekdays it is due on, station, priority and assignee. Each day it is due,
`materializeRecurring(state, today)` (`lib/recurring.ts`, pure) makes an **ordinary manual `Task`** from it,
tagged `recurringId`. That is the whole design: from its first moment the task is indistinguishable from one
a person typed, so completing, assigning, deleting, undo and the carry-over all work by code that already
exists, and there is no second display path to keep in step. Free-text only — a recipe-backed prep task
already comes back by itself from stock.

Three rules in it are load-bearing. **`lastMaterialized` is why a deleted instance does not come back:** the
rule has already answered for that day, so the idempotent re-run does not make it again (without it, ✕ on
today's task would be undone by the next render). **No stacking:** an instance still open — typically
yesterday's, carried over — *is* the task for today, so a daily task left undone does not become a pile;
`DayRollover` runs the carry-over **before** the materialize for exactly that reason. **Ids are
deterministic** (`rec-<rule>-<date>`), so two devices making the same day's task make the same task. No
back-fill for days nobody opened the app. `UPDATE_RECURRING_TASK` keeps `lastMaterialized`, so saving a rule
twice in a day does not make today's task twice, and it changes future days only.

**Chef only, and the server agrees.** `ADD/UPDATE/DELETE_RECURRING_TASK` are `'chef'` in `action_requires`
(migration 0010, same mechanism 0008 used for stations; `scripts/verify-migrations-local.sh` covers it).
**`MATERIALIZE_RECURRING` is deliberately open to every member**: it is sent by whichever device opens the
app first, very often a cook's, and it is a pure function of state and date. Until 0010 is applied nothing
breaks — the actions are simply open, as for any action the server does not list. UI: a "חזרה" block in
`AddManualTaskSheet` (chef, free-text tasks), and `screens/RecurringTasks.tsx` (`/recurring`, from the menu)
to edit, pause or delete a rule (`deleteWithUndo`, so no confirmation). `WeekdayPicker` is seven real toggles.

### Contrast and tap size are tokens (2026-10-02, no migration)

Four tokens in `tokens.css` carry what used to be per-rule guesses, each measured rather than
eyeballed. **`--color-border-input`** (3.18:1 on the surface) is the edge of anything you type or tap
into; **`--color-border`** (1.34:1) stays for hairlines between cards, where it is right, and is too
faint to be the only thing marking a field (WCAG 1.4.11). **`--color-link`** replaces the browser's
default `#0000ee` (2.1:1 here), applied by one bare `a` rule that every classed link overrides.
**`--color-red-solid`** is the red for a *fill under white text* (nav badge, `.btn-danger`, 5.56:1);
`--color-red` is still the red for text and stripes on a dark ground, where it is 5.6:1 and white-on-it
would be 3.55:1. **`--tap-min`** (44px) is the floor for anything a thumb must hit.

Anything that looks smaller than 44px gets the area without looking bigger: `.prio-chip` and
`.task-title` use a `::after` that extends past the box. No text below 12px. `.count-save-bar::before` fades the list out under the
floating save/approve button.

### Each colour means one thing (2026-10-02, no migration)

The neon green was carrying five meanings (the action, the active tab, done, "fine", and every number
on the planning screen), so a list of fine things read as a list of buttons. The rule now:

- **`--color-primary` (neon green): do this, or you are here.** Primary buttons, the active tab and nav
  slot, a selected chip, the field you fill in on the morning order. Also *done* (the ticked box, the
  swipe-right panel, the progress fill), because completing is the action.
- **`--color-ok` (muted green): fine.** `.pill.green` (enough stock, nothing to prepare today, a saved
  toast). A status is never the brand green.
- **White: a number.** `.number-editor-value` is white with a dotted underline as the hint that it can be
  tapped. `.emphasis` (neon) marks the one number on a row that asks something of you ("הכנה להיום"
  when above zero); `.zero` mutes it when nothing is needed.
- **Yellow: needs attention, but not yet.** **Red: this cannot be done now** (an expired item, a task
  missing an ingredient, a failed action). A projected shortfall in the week strip is yellow while it is
  for a later day and red (`.week-day.urgent`) only for today or a day already past.
- Headings are muted text, not green (`.supplier-group`).

`WeekStrip` also brings the selected day to the middle of its scroll area and calls today "היום". The
`.stat-card` rules (including a purple "neutral" variant) have no caller and were left alone; they are
dead code, not part of this palette.

### Tablet, focus, motion

Three rules at the bottom of `global.css`, each fixing something that was invisible on the phone
this app was built against:

- **Breakpoints at 768/1024px.** `--content-max` (720 → 900 → 1040) is the single width every
  consumer reads — `.app-main`, `.sheet`, `.count-save-bar`'s button and `.bottom-nav` — because a
  breakpoint that widened three of the four would put the nav out of line with the content above it.
  `.tasks-grid` goes 1 → 2 → 3 columns (rows, not cards), since "how many prep tasks fit without
  scrolling" is what the extra width is *for*. `.keypad-grid`, `.stat-grid` and `.weekday-usage-grid` deliberately do
  not move — a keypad is a keypad, there are three stats, and there are seven weekdays.
- **A global `:focus-visible` ring.** There was exactly one focus rule in the whole stylesheet, which
  was fine while every control was touch-only and a real hole the moment phase 4 gave the completion
  checkbox a keyboard path — `body` sets `-webkit-tap-highlight-color: transparent`, so nothing else
  was left to show focus either. `:focus-visible` rather than `:focus`, and `outline` rather than a
  border or box-shadow so it never reflows what it is on.
- **`prefers-reduced-motion`.** Everything animated in this app is decoration (the skeleton's shimmer) and none of it carries
  information the colour or shape doesn't, so it all simply stops. Transitions are cut to ~0 rather
  than to `0s`, because a few of them are `:active` feedback a cook does rely on feeling.

### Security headers and the service worker — the bits `vercel.json` can't comment on

`vercel.json` is JSON, so it carries no comments; the reasoning for what's in it lives here.

**CSP.** `script-src 'self'` works because the production build emits no inline script —
`vite-plugin-pwa` is configured with `injectRegister: null` and `UpdatePrompt.tsx` registers the
worker from app code instead. `style-src` needs `'unsafe-inline'` and always will: this codebase
uses React `style={{…}}` attributes on almost every screen. `connect-src` covers Supabase over
both https and wss plus `*.sentry.io`; `*.i.posthog.com` (analytics) is there too; a missing
entry fails as a silent network error, not a build error. `https://challenges.cloudflare.com` is
in `script-src` **and** `frame-src` — Turnstile renders itself in an iframe, so allowing only the
script gives a widget that never appears; it costs nothing while `VITE_TURNSTILE_SITE_KEY` is
unset, since nothing requests it. `https://vercel.live` (and the
`wss://ws-us3.pusher.com` it talks to) is allowed for the preview-comment toolbar, which Vercel
injects into preview deployments only — it costs nothing in trust terms, since Vercel already
serves every byte of this app, and without it the review workflow in "Branch workflow" above
breaks.

**Fonts are bundled, not linked.** Rubik comes from `@fontsource/rubik`, imported in `main.tsx` —
four weights (400/600/700/900, matching what the CSS actually uses; 900 is `.stat-card
.stat-value`) in two subsets. Hebrew for the text, **Latin for the digits**, which is why a
Hebrew-only app still needs it. This is also what lets `font-src` stay `'self'`.

**The service worker serves the app shell and nothing else.** Everything bound for Supabase or
`/api/` is `NetworkOnly`, deliberately — `ops?seq=gt.N` responses are *deltas*, meaningless
without the `confirmedSeq` the worker knows nothing about, and a cached one would silence
`foldContiguous`'s gap detection, which is the actual correctness guarantee. See the long note
on `kitchenPwa()` in `vite.config.ts` before changing any caching rule.

**A new worker waits rather than claiming.** `skipWaiting` and `clientsClaim` are both false, so
a live page never has its controller swapped under JavaScript from the old bundle. One real
consequence to know: **the very first visit is never controlled by the worker**, so offline only
works from the second launch onward. That is the correct trade — the alternative risks exactly
the bundle mismatch `upgrade-required` exists to prevent — but it means "install and immediately
go offline in the same tab" does not work.

**Installing on an iPhone is explained, not offered.** iOS has no install prompt and no API to call, so
`lib/installHint.ts` (pure, tested) decides whether the explanation is *true* for this page — an iPhone/iPad
(including an iPad that reports itself as a Mac, told apart by its touchscreen), in a browser tab
(`navigator.standalone` and `display-mode: standalone` both false), outside an in-app browser — and
`InstallHintCard` shows on the task list and on `PendingApproval` (waiting for the chef is the natural moment).
"לא עכשיו" is remembered in `kitchen-install-hint-dismissed`; the menu row "הוספה למסך הבית" ignores that, so
the steps stay findable. The load-bearing line is step 3: **a home-screen icon is a separate app from the
Safari tab it was added from and does not share its sign-in**, so the first launch asks for e-mail and
password again — said up front it is a one-time step, unsaid it looks like the account was lost. For the same
reason the invite link (`kitchen-pending-invite` is banked in the browser's storage) must be finished in the
browser before installing. WhatsApp's in-app viewer cannot be told from Safari by its user agent, so it simply
shows the steps. Not built: a real install button for Android (its browser has its own prompt).

**Notched iPhones, installed from the home screen — what is known and what is not.** `index.html` uses
`apple-mobile-web-app-status-bar-style="black"` plus `viewport-fit=cover`. It was `black-translucent`, which
draws the page *under* the status bar; two things went wrong on an iPhone 13 Pro launched from the icon (a
Safari tab was fine): the clock covered the screen title, and the bottom nav sat ~45pt above the bottom edge
with a dead strip beneath. The first is certain and fixed twice over (`black` starts the page below the bar,
and `.app-main` / a `body::before` strip / `.sticky-tabs` also honour `env(safe-area-inset-top)`, which is 0
under `black`). **The second's cause is a hypothesis**: the layout viewport came out about one status bar
shorter than the screen, which `black` should cure. It could not be reproduced without the device; if the
strip is still there on an icon added *after* this change, add an on-screen readout of `innerHeight`,
`screen.height` and the insets rather than guessing again. **iOS reads the status-bar style when the icon is
added** — an icon from before the change must be removed and added again (and signed in to again). Chromium
can show an inset with CDP `Emulation.setSafeAreaInsetsOverride` (`isMobile`, 440x956, top 62 / bottom 34),
but not this viewport quirk.

**Do not add `manualChunks`.** It was measured on this codebase and is a net loss; `vite.config.ts`
carries the numbers.

### RTL / Hebrew

The whole app is Hebrew and right-to-left (`<html dir="rtl" lang="he">` in `index.html`). Keep new UI text
in Hebrew and be mindful of RTL when using directional CSS (`margin-inline-start` etc. over left/right).

---

## ⚠ Continuing this work: multi-device sync status (2026-09-06)

The user asked for real-time sync between phones so every cook at a restaurant sees the same
data. This is being built in ordered phases against a **real, already-created Supabase project**
(not a plan on paper) — each phase below was verified live, not just unit-tested, before moving
to the next. If you're picking this up in a new session: read this whole section before touching
sync-related code. **The concrete next steps now live in the pre-launch audit section at the very
bottom of this file**, not here — this section is the record of how sync was built.

**Done — phases 0 through 6, all verified live (Phase 6's new failure-mode paths are unit-tested;
see its entry below for why those specifically weren't also poked at live):**

- **Phase 0** — reducer made replay-safe: `today` passed explicitly instead of read from the wall
  clock (`SET_PRODUCT_QTY`/`BULK_UPDATE_QUANTITIES`), `null`-as-clear sentinel (JSON drops
  `undefined` keys — this was a real, previously-undetected bug in `SET_DAY_PLAN_ENTRY`'s "reset
  to automatic" button), idempotency guards on `RECEIVE_ORDER` and both `CONFIRM_*_COMPLETION`,
  `TOGGLE_ORDER_LINE_ORDERED` → absolute `SET_ORDER_LINE_ORDERED`, `crypto.randomUUID()`-based ids
  everywhere `Date.now()` used to be. A JSON-round-trip test table in `reducer.test.ts` guards
  this class of bug permanently.
- **Phase 1** — the pure sync engine (`src/sync/{types,log,engine,persist,localAdapter,store}.ts`)
  and `AppContext` rewired onto it via `useSyncExternalStore`, running on the local adapter.
  Pixel-identical to the pre-sync app; verified live (edit → reload → persisted, zero console
  errors) before any network code existed.
- **Phase 2** — a real Supabase project created, `supabase/migrations/0001_init.sql` +
  `0002_fix_join_restaurant.sql` applied to it, "Confirm email" disabled, `.env.local` holds the
  real URL/anon key (gitignored via the `*.local` rule — ask the user if you need the values, or
  find them yourself in the Supabase dashboard under Project Settings → Data API). All RPCs
  verified end to end against the live project with `scripts/verify-supabase.mjs`, including RLS
  isolation (a non-member sees zero rows) and seq contiguity across two different accounts.
- **Phase 3** — `src/auth/`, `Auth.tsx`/`Onboarding.tsx`, `Gate.tsx`, engine deliberately still on
  the local adapter (auth validated independently of sync, per the original plan). Verified live:
  signup → create restaurant → reload persists session/membership → sign-out → sign back in →
  correctly skips onboarding (already a member) → `kitchen-force-local` still fully bypasses auth.
- **Phase 4 — the milestone: real multi-device sync is live.** `supabaseAdapter.ts` wired into
  `AppContext`, `SyncBadge` added. Verified live: an op appended from a **separate Node process**
  (`scripts/second-device-test.mjs`) appeared in the browser in real time via realtime, with zero
  action in the browser; a browser edit landed in the DB with the correct next seq; reload
  persists via the per-restaurant `kitchen-sync-<id>` cache with no boot flash; going offline
  queues changes (`SyncBadge` shows the count) without sending, and flushes correctly on
  reconnect — all confirmed by querying the `ops` table directly, not just by trusting the UI.
  **Two real bugs found only by testing against the live backend** (neither caught by any unit
  test, and worth remembering as a class of risk for whatever comes next): a `newId('op')` vs
  `newUuid()` mismatch (`ops.op_id` is a Postgres `uuid` column; a prefixed string like `op-<uuid>`
  fails `22P02` and was silently retried forever) — fixed, with a regression test in
  `ids.test.ts` — and a `join_restaurant` `ON CONFLICT (restaurant_id, user_id)` that was
  ambiguous against that function's own `RETURNS TABLE (restaurant_id, ...)` OUT parameter (fixed
  in `0002_fix_join_restaurant.sql` by naming the constraint instead of listing columns).
- **Phase 5 — cook binding and Settings.** `src/screens/PickCook.tsx` ("מי אני" — pick an existing
  `Cook` row or type a new name, which dispatches `ADD_COOK` then calls `setMyCook`), a `CookGate`
  in `Gate.tsx` (sits *inside* `AppProvider` for exactly this reason — it needs `state.cooks` —
  and renders `PickCook` whenever `membership.cookId` is still null; a no-op in local mode).
  `Settings.tsx` now shows, only when `isSupabaseConfigured`: the signed-in email, the
  restaurant's join code as a tap-to-copy pill, a sync-status line (`useSync()`, beyond what the
  badge shows) with any `lastError`, and a sign-out button (previously only reachable from
  `Onboarding`, which you can't get back to once you have a membership). JSON-backup import now
  branches on mode: local mode still dispatches `IMPORT_STATE`; remote mode calls the
  `reset_snapshot` RPC directly and lets the existing `SNAPSHOT_MOVED` → re-bootstrap path (see
  `supabaseAdapter.subscribe`/`engine.ts`) pick up the new state — no new sync-engine code needed,
  since that plumbing already existed for exactly this case. Deleting a cook now checks a
  `memberships` query (readable for any teammate row at your own restaurant, per `memberships_read`
  RLS) for whether that cook is any account's `cook_id`; if so, `ConfirmDialog` warns before
  deleting rather than silently orphaning that membership's `cook_id`. All of the above verified
  live against the real project (existing `browser-test-1@example.com` membership with no cook
  bound rendered `PickCook`, picking a cook advanced straight into the app, `Settings` showed the
  real join code/email/sync status, and deleting the now-bound cook correctly prompted the
  confirm dialog) as well as in forced-local mode (pixel-identical to before, no Supabase section,
  no delete confirmation).
- **Phase 6 — hardening.** `SyncAdapter.bootstrap()` now also returns `schemaVersion` — the
  restaurant's own `schema_version` column, deliberately kept separate from `confirmed.schemaVersion`
  (a field inside the snapshot blob) even though they're usually equal, because the two are
  conceptually different questions (see the comment on `SyncAdapter` in `sync/types.ts`).
  `BOOTSTRAP_OK` compares it against this build's own `SCHEMA_VERSION` (`data/seed.ts`): a client
  behind the server's schema flips `status` to `'upgrade-required'` — sticky, since no amount of
  incoming ops can fix a client built against an older shape — which `maybeAppend` now checks
  before ever emitting APPEND, and `SyncBadge` already rendered ("יש לרענן את האפליקציה") from
  Phase 4's design, unreachable until now. `src/sync/backoff.ts` is new: `backoffMs(attempt)` is
  a deterministic exponential curve (4s → 8s → … capped at 60s), kept free of `Math.random()` so
  engine.ts stays exactly reproducible in tests; `withJitter(ms)` (±25%) is applied only in
  `store.ts`, the one place that actually schedules a real `setTimeout`, both for `RETRY_IN` (now
  driven by `SyncState.retryAttempt`, incremented on `APPEND_ERR` and reset to 0 by anything that
  proves the connection works — `APPEND_OK`/`OPS_IN`/`ONLINE`/a fresh `BOOTSTRAP_OK`) and for the
  `FETCH_OPS` retry loop (previously a flat 5s `setTimeout`, now a self-recursing backoff entirely
  local to that closure — no new engine event needed). `store.ts` also now tracks `pendingSince`
  as a wall-clock companion to `SyncState.pending` (deliberately *not* part of the pure engine
  state, since it's UI telemetry, not something correctness depends on): once the oldest queued op
  has sat for 10+ minutes, `useSync()` exposes `stalePendingMinutes` and both `SyncBadge` and
  `Settings` escalate to an explicit "still not sending" warning, refreshed every 30s by a timer so
  the displayed duration keeps climbing even with no new sync events. `maybeAppend` now also caps
  a single `APPEND` at 200 ops (`append_ops` rejects a bigger batch server-side) — a queue longer
  than that drains in successive round trips automatically, since each batch's own `APPEND_OK`
  frees `inFlight` and `settle()` calls `maybeAppend` again. `engine.test.ts` gained coverage for
  all of the above plus a broadened convergence property test (array-mutating ops alongside scalar
  ones, longer op sequences, more trials, and a third delivery shape — shuffled-order rows in one
  batch — alongside the existing all-at-once/one-at-a-time comparison). Verified live against the
  real project (schema versions match today, so sync still shows "מסונכרן" as before; toggling the
  browser's online/offline events still flips the badge correctly) — the upgrade-required and
  backoff paths themselves are exercised by the new unit tests rather than by forcing a live schema
  mismatch or a real dropped connection, since neither is easy to trigger safely against the shared
  live project.

> **Note on the entries below:** they are the record of what was done at the time and are left as
> written. `Home.tsx` and `Tasks.tsx` are referenced throughout and no longer exist — the pre-launch
> audit's phase 4 merged them into `src/screens/Today.tsx` plus `src/screens/tasks/`. Read those
> references as history, not as a map of the current tree.

**Also done — granular permissions, dated order history, tasks by station (2026-09-09,
branch `claude/rls-granular-abac-wgbz0z`):** three features layered on top of the sync work
above, none of which needed a new table:

- **Granular ABAC.** The role vocabulary migrated from `owner`/`member` to `chef`/`cook`
  (`supabase/migrations/0003_rls_and_granular_roles.sql`), and `memberships` gained
  `can_edit_recipes`/`can_delete_recipes` flags a chef can grant a cook individually. Because
  there is no `recipes` table — every recipe lives inside `snapshots.state`, one jsonb blob per
  restaurant — RLS itself stays untouched (still SELECT-only everywhere, per the design notes at
  the top of `0001_init.sql`); permission enforcement instead lives inside `append_ops` itself,
  the one chokepoint every write already passes through, via a new `action_requires()` helper
  that maps an op's action type to the permission it needs. A rejected batch is flagged
  `permanent` all the way back to the sync engine (`src/sync/engine.ts`'s `APPEND_ERR` handling)
  so a forbidden op drains from the queue instead of retrying forever. `src/auth/usePermissions.ts`
  exposes `{ role, isChef, canEditRecipes, canDeleteRecipes }` (full permissions in local mode —
  a single-device user is their own chef), consumed by `ChefOnly` (`src/components/Gate.tsx`),
  the gated save/delete paths in `Recipes.tsx`/`RecipeEditor.tsx`, and a new "הרשאות צוות" section
  in `Settings.tsx` (chef-only) with a `set_member_permissions` RPC behind it.
- **Dated order history.** `OrderLine` gained a `date` field — see `orderLineKey`
  (`src/lib/date.ts`) for the composite `(ingredientId, date)` key; deliberately no synthetic id,
  since ops carry reducer actions, not rows. `SUBMIT_ORDER` is a new absolute-set reducer action
  (idempotent under replay, same reasoning as `SET_ORDER_LINE_ORDERED`). The server-side half of
  the `SCHEMA_VERSION` 3→4 bump (`supabase/migrations/0004_order_history.sql`) rewrites every
  restaurant's stored `orderLines` in place with a jsonb rewrite rather than a table alter, since
  there's no `order_lines` table either — see that migration's own comment for why. `Orders.tsx`
  is now two tabs (`CategoryTabs`): the existing current-order table, and a new weekly history
  grid highlighting (`.pill yellow`/`.pill red`) an ingredient's day against its own weekly mean.
- **Tasks by station.** `DisplayTask` (`src/lib/tasks.ts`) gained a resolved `category` — a
  recipe-backed task's own recipe category, else a free-text task's new `Task.categoryOverride`,
  else `'general'`. `Tasks.tsx` reuses the same `CategoryTabs` station row as `Recipes.tsx` (the
  shared list now lives in `src/lib/recipeCategories.ts` rather than being duplicated a third
  time), and `SET_TASK_ASSIGNEE` (manual tasks) plus the already-existing but previously-unused
  `SET_AUTO_TASK_ASSIGNEE` back a `<select>` on every task row.

All three SQL migrations (`0003`, `0004`, `0005`) have been applied by hand to the live Supabase
project — nothing in the build does this automatically, so any *future* migration needs the same
manual step before synced clients can use it (until then they sit at `upgrade-required` and refuse
to append, which is the expected signal that it hasn't landed yet).

**Also done — quiet sync badge, restaurant name in the Home header, task priority/done styling,
chef removes a teammate (2026-09-12):**

- **SyncBadge is quiet when healthy.** It now renders nothing while `status === 'live'` with no
  pending ops and no stale-pending warning, and any non-quiet state is debounced 1s before
  appearing (`src/components/SyncBadge.tsx`) so a routine reconnect never flashes. Repositioned
  from `position: fixed` over the header (where it overlapped Home's title) to a `.sync-badge`
  class fixed just above the bottom nav (`src/styles/global.css`).
- **Home shows the real restaurant name.** `CachedMembership` (`src/auth/authCache.ts`) gained an
  optional `restaurantName`, populated from the embedded `restaurants(name)` join on the
  membership fetch and from `createRestaurant`/`join_restaurant`'s own inputs/returns
  (`src/auth/AuthContext.tsx`). `Home.tsx` renders `membership?.restaurantName?.trim() || 'ניהול
  מטבח'` — local mode (no membership) keeps the old fallback exactly.
- **Task cards get priority borders and an unambiguous done state.** `Tasks.tsx`'s `TaskRow` now
  reuses the `.priority-card` convention from Home, and `.priority-card.done` (green background,
  strikethrough title) overrides the priority border once a task is marked done. Low priority
  (`green`) was changed to a muted border in `global.css` so green unambiguously means "done"
  app-wide, not "low priority" — this also softens Home's low-priority cards.
- **A chef can remove a teammate.** New `remove_member(p_user_id)` RPC
  (`supabase/migrations/0005_remove_member.sql`, chef-only, can't remove self) — just a
  `memberships` delete, since neither `ops` nor any task table references a membership row.
  `AuthContext.removeMember` calls it; the reducer's new `REMOVE_COOK` action (alongside the
  existing `DELETE_COOK`) unassigns that cook from open tasks/overrides while leaving completed
  ones' `assigneeId` untouched, preserving "who did it" history. `Settings.tsx`'s "הרשאות צוות"
  section gained a remove button per non-chef row behind a destructive `ConfirmDialog`
  (`ConfirmDialog` gained a `destructive` prop rendering `.btn-danger`). `0005_remove_member.sql`
  is applied to the live project and verified end to end both at the RPC level
  (`scripts/verify-remove-member.mjs` — chef-only, can't-remove-self, no-such-member, and a
  removed cook's own membership read coming back empty) and live through the actual Settings UI
  (a chef account removing a bound cook correctly cleared both the membership row and the local
  `Cook`, live against the real project).

**Also done — merged ingredient management into the stock-count screen (2026-09-11):**
`src/screens/Ingredients.tsx` is gone; `/ingredients` now redirects to `/count`, and the "מצרכים"
nav slot routes there directly. `StockCount.tsx` absorbed the ingredient database UI (add, rename,
edit usage/par/unit/supplier, delete) into the counting walk-through's ingredient table, plus a
live "מספיק ל-" coverage column computed from whatever is currently typed in that row (not the
stored quantity), so a cook sees the consequence of a count before saving it. No reducer or schema
change — `UPDATE_INGREDIENT` (unused since it was added) now has its first caller, for the sheet's
name/supplier fields. See the "Screens and navigation" section above for the two-commit-model design
this required.

**Superseded:** the old "Phase 7" note here proposed `vite-plugin-pwa` for a real offline cold start.
That landed in the pre-launch audit's phase 3 (below). `compact_snapshot` is still wired in SQL and
still unused — worth doing if the `ops` table ever grows large enough to matter.

**Also done — expiry dates and the chef's waste log (2026-10-01):** `Ingredient.expiresOn` /
`Product.expiresOn` (one last-good day per item, not per batch) and `AppState.wasteLog` — all
optional, so no `SCHEMA_VERSION` bump. `lib/expiry.ts` (`expiredItems`: past its date *and* still in
stock) and `lib/waste.ts` (entry builder, week/month ranges, per-item totals) are pure and tested.
Three reducer actions: `SET_EXPIRY` (absolute; `null` clears), `LOG_WASTE` (appends the row, takes
`entry.qty` out of stock, ignores an id it already has; clears an expired item's date only once the
stock is used up, so a partial throw keeps flagging the rest), and `UNDO_WASTE` (puts stock and date
back). The `WasteEntry` row snapshots the item name/unit and is never pruned by `pruneEntities`, so
the history survives deleting the ingredient. The "מה התקלקל?" quick action now logs too
(`reason: 'spoiled'`). UI: `ExpiryBanner` on the task list (everyone — whoever opens the fridge acts
on it: זרוק with an editable quantity, or האריך), `ExpiryField`/`ExpirySheet` for setting a date
(ingredient detail sheet; a new small product sheet in the stock count), and a chef-only
`/waste` screen (`ChefRoute`) with the log and a weekly/monthly summary. **"Chef-only" is a client
rule**: like orders and consumption, there is no table for RLS to guard (everything lives in the one
snapshot blob), and no migration was needed — the new actions are open to every member in
`action_requires`, on purpose, because discarding food is a floor-level action.

**Also done — shelf life of prepared products (2026-10-02, no migration):** a recipe carries
`shelfLifeDays` (whole days after the day it is made; 0 = that day only; blank = none), set in
`RecipeEditor` under "חיי מדף (ימים)" — a recipe edit, so `can_edit_recipes` already governs it
server-side and no rule was added. Completing a prep task dates the batch: `completeTask` computes
`producedExpiresOn` from the **caller's `today`**, never the clock (the action replays on every device),
and both `CONFIRM_*_COMPLETION` actions carry it. The reducer's rule is **earliest date wins**
(`batchExpiry`, `lib/expiry.ts`): with stock already on the shelf the older, earlier date stays, so the
whole stock is flagged as soon as the oldest part is due — it can only ever flag early, never hide
something that has turned. `Product.lastBatchExpiresOn` remembers the newest batch's own date for the
one moment it matters: when the expired part is thrown and a newer batch is left, `ExpiryBanner` asks
"עד מתי?" with that date one tap away (`remainingExpiry`). The completion stores an `ExpiryChange`
(before/after) in `appliedCompletion`, so undo puts back exactly the old dates — and **only if nobody
changed them since** (an extension made after the completion is newer information). After completing,
`BatchLabelProvider` (above `<Outlet />`, like `UndoProvider`, because the card leaves the open list the
moment it is done) shows "כתבו על המכל": name, made-on, good-until, cook initials, and a warning when an
older batch is still on the shelf. It carries its own "בטל" and replaces the toast for those completions.
**Decision: expired stock stays counted as stock until someone confirms it was thrown** — nothing
auto-subtracts it; the prep task for it appears only after the discard. Until then the task card says
"יש מלאי שפג תוקפו — בדקו" and the red banner stays. The banner also has a quiet yellow line for what is
due today or tomorrow (`soonItems`). **Easy to miss:** `SAVE_PREP_ITEM` / `UPDATE_PRODUCT` replaced the
whole product with what the editor sent, and the editor has no expiry field, so every recipe edit used
to erase the product's dates — `keepExpiry` in the reducer now carries them over. Not built, on purpose:
real batches (FIFO), per-storage shelf lives (fridge vs. freezer), label printing, push notifications.

---

## ⚠ Continuing this work: the pre-launch audit (2026-09-30)

A second, separate track from the sync work above: getting the app to a state where it can be handed
to a real restaurant crew — no white screen mid-shift, no torched Gemini account, no irreversible data
loss. Run as ordered phases, **one PR per phase, each verified live and merged only on explicit
approval in chat**. The architecture sections above describe what each landed; this is the status.

**Done — phases 1 to 7:**

1. **Resilience** — error boundaries, the `routes.tsx` route table, the missing 404 screen, Sentry with
   aggressive scrubbing, the three reset tiers. See "Nothing white-screens" above.
2. **`/api/scan-recipe` closed** — migration `0006`, token + membership + three-tier quota, the shared
   request pipeline, and the `app_config` kill switch. See "Closing /api/scan-recipe" and
   "The kill switch" above.
3. **Security headers, a real PWA, a smaller bundle** — `vercel.json`, self-hosted fonts, the service
   worker, route-level lazy loading, `tesseract.js` removed. See "Security headers and the service
   worker" above. Entry chunk went 405.92 kB → 300.90 kB (124.41 → 95.40 kB gzipped).
4. **Home merged into Tasks** — `Today.tsx`, the shared task selectors, the accessible completion
   checkbox, `/` → `/tasks`. See "Screens and navigation" above.
5. **Tablet, accessibility, polish** — breakpoints, the focus ring, reduced motion, `BottomSheet`
   as a real dialog, the shared `Toast`, and auth forms a password manager recognizes. See
   "Tablet, focus, motion" and "Transient confirmations" above.

6. **Privacy, accounts, bots** — migration `0007`, import validation, the legal routes outside
   every gate, and dormant Turnstile. See "Erasure, a rotatable key, and a ceiling on guessing"
   and "Importing a backup is the most destructive path in the app" above. Two deliberate
   departures from the plan, both simplifications: account deletion is one SQL RPC rather than an
   RPC *plus* an Edge Function, since nothing it needs is out of SQL's reach (the Edge Function
   stays documented as the fallback if a project ever blocks `delete from auth.users`); and the
   legal documents are real screens in `src/screens/Legal.tsx` rather than strings in
   `src/content/legal.ts`, because they need navigation between themselves and back to the app.
   **`OPERATOR` at the top of `Legal.tsx` is still placeholder text** — a notice with
   `privacy@example.com` in it is not a notice, and that is the one blocking item in
   LAUNCH-CHECKLIST.md that no code change can clear.

7. **CI, analytics, process.** Landed on `claude/wizardly-hawking-fj6znn`. Three parts:

   - **CI** — `.github/workflows/ci.yml`: `lint` + `test` + `build` on every PR and push to `main`,
     and a second job running `scripts/verify-migrations-local.sh` against the runner's own
     PostgreSQL (the only check that exercises a migration before it is pasted anywhere). **Turn
     on branch protection for `main` requiring both jobs** — the workflow alone stops nothing.
   - **Analytics** — `src/lib/analytics.ts`. **Deliberately not `posthog-js`**: that SDK ships
     autocapture (`$el_text` = the text of every clicked element = ingredient/recipe/cook names),
     session recording, a cookie, flag polling and lazily loaded scripts, each defaulting the
     wrong way here. The module posts to PostHog's `/batch/` endpoint directly and can send three
     events only — `app_opened`, `screen_viewed` (route *name*, never a pathname), and `action`
     (an `Action['type']` from a short allowlist, never its payload) — built from a closed type,
     with the wire format pinned in `analytics.test.ts`. Dormant three ways: no
     `VITE_POSTHOG_KEY`; **local mode** (that mode promises no network); or opted out (Settings
     toggle, Do Not Track, Global Privacy Control). `distinct_id` lives in memory for one page
     load — nothing is written to the device, so no consent banner is owed, at the cost that a
     returning cook is a new visitor each launch. `store.ts`'s `dispatch` calls `trackAction`
     beside `addOpBreadcrumb`; `AnalyticsContext` (sibling of `SentryContext`) reports screens.
     `Legal.tsx` was updated in the same commit, as it said it had to be. Verified live against
     a Chromium: on → exactly one `app_opened`; no key, local mode, DNT, opted out → no request.
     `screen_viewed`/`action` live behind the auth gate and are covered by unit tests only.
   - **Process** — `supabase/config.toml` and `.github/workflows/supabase-migrate.yml`, a
     **manual-only, dry-run-by-default** `supabase db push`. First use needs a one-time
     `supabase migration repair --status applied 0001 … 0007`, because the live history is empty
     (see the workflow header). **This workflow has not been run** — the CLI isn't installable
     from here — so treat the first dry run as its test.

   Remaining item that no code can clear: **`OPERATOR` in `Legal.tsx`** (see LAUNCH-CHECKLIST.md).

**Environment reminder:** this dev machine already has a working `.env.local` — running
`npm run dev` here exercises real Supabase auth, not local mode. Use
`localStorage.setItem('kitchen-force-local','1')` in the browser to get local-only behavior back
for a quick check. `scripts/{verify-supabase,check-ops,second-device-test,verify-remove-member,verify-scan-quota,verify-account-rpcs}.mjs`
are throwaway manual verification tools (`node scripts/<name>.mjs`) — not part of the build, safe
to delete or extend as needed; `scripts/{verify-a11y-ui,verify-auth-forms,verify-legal-and-account}.mjs`
are the browser-driving ones and need `npm install --no-save playwright` first. If the bundled
Chromium's build number does not match the installed Playwright, point them at it explicitly:
`CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome`. A few demo accounts/restaurants exist in the live project from this testing
(e.g. `browser-test-1@example.com`) — the user has said to leave that data as-is.
