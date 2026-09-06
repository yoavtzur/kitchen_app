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

There are 11 test files (130 tests), colocated in `__tests__` folders next to what they cover:
`src/lib/__tests__/{calc,date,ids,integrity,tasks}.test.ts`, `src/store/__tests__/{reducer,storage}.test.ts`,
`src/sync/__tests__/{engine,localAdapter,log,persist}.test.ts`. No jsdom, no React Testing Library —
everything is tested as pure functions in node, including the entire sync protocol (see below).

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
`CONFIRM_AUTO_TASK_COMPLETION`, etc. — see `src/screens/Tasks.tsx`).

### "Last edit wins" between Home and Consumption screens

A product's "prep needed today" can come from either an automatic calculation or a manual override
entered on the Consumption screen (`DayPlan.entries[].prepOverride`, set via `SET_DAY_PLAN_ENTRY`).
Editing a product's current quantity on the Home screen (`SET_PRODUCT_QTY`) deliberately clears *today's*
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

**Supabase schema**: `supabase/migrations/0001_init.sql` (already applied to the project in
`.env.local`) plus `0002_fix_join_restaurant.sql` (a real bug fix, also already applied). Four tables: `restaurants` (name, `join_code`, `last_seq`, `snapshot_seq`),
`snapshots` (the big jsonb blob, kept off `restaurants` so that table stays realtime-cheap),
`memberships` (`user_id` ⇄ `restaurant_id` ⇄ `cook_id`, one restaurant per user in v1), `ops`
(append-only, `seq` allocated from `restaurants.last_seq` under a row lock inside `append_ops` —
**a per-restaurant contiguous sequence, not a `bigserial`**, because gap detection is meaningless
over a sequence with holes). RLS is SELECT-only everywhere; every write is a `SECURITY DEFINER`
RPC (`create_restaurant`, `join_restaurant`, `append_ops`, `set_my_cook`, `reset_snapshot`,
`compact_snapshot`), because RLS alone can't express "insert only once you're already a member"
or "allocate the next seq under a lock". `scripts/verify-supabase.mjs` and
`scripts/check-ops.mjs` are manual, throwaway verification tools against the live project — not
part of the app or the build.

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
no server routing) → `AuthProvider` → `.app-shell`/`.app-main` (wraps everything, auth/onboarding
screens included, for consistent styling) → `AuthGate` → `MembershipGate` → `AppProvider` →
`SyncBadge` + `Routes` + `BottomNav`. `BottomNav` and `SyncBadge` only ever mount once every gate
has passed. Screens live flat in `src/screens/` (app screens plus `Auth.tsx`/`Onboarding.tsx`);
shared UI (bottom sheets, number editors, priority dots, sync/gate chrome, etc.) lives in
`src/components/`. `BottomNav` is the primary navigation — Home, Tasks, Ingredients, Recipes,
Consumption each have a dedicated icon; anything else (Orders, Settings) is under "עוד" (More).

Editing UI follows one recurring pattern: tap a value to open a `BottomSheet` containing a `NumberEditor`
or form, dispatch on save. Look at `src/screens/Ingredients.tsx` or `Consumption.tsx` before inventing a
new editing pattern.

### RTL / Hebrew

The whole app is Hebrew and right-to-left (`<html dir="rtl" lang="he">` in `index.html`). Keep new UI text
in Hebrew and be mindful of RTL when using directional CSS (`margin-inline-start` etc. over left/right).

---

## ⚠ Continuing this work: multi-device sync status (2026-09-06)

The user asked for real-time sync between phones so every cook at a restaurant sees the same
data. This is being built in ordered phases against a **real, already-created Supabase project**
(not a plan on paper) — each phase below was verified live, not just unit-tested, before moving
to the next. If you're picking this up in a new session: read this whole section before touching
sync-related code, then jump to "Next: Phase 7" for the concrete next step.

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

**Not started — Phase 7 (optional):**

- Wire `compact_snapshot` (already in the SQL, unused) to a client-side threshold. Separately,
  consider `vite-plugin-pwa`: there is still no service worker, so "offline" today only covers a
  tab that's *already open* — a cold offline launch won't load the app's JS at all, which
  undercuts the offline queue's value for a kitchen with patchy wifi.

**Next: Phase 7 (optional — the sync/auth/UI work above is otherwise feature-complete).** Start
with `compact_snapshot` if the `ops` table is growing large enough to matter, otherwise
`vite-plugin-pwa` for a real offline cold start.

**Environment reminder:** this dev machine already has a working `.env.local` — running
`npm run dev` here exercises real Supabase auth, not local mode. Use
`localStorage.setItem('kitchen-force-local','1')` in the browser to get local-only behavior back
for a quick check. `scripts/{verify-supabase,check-ops,second-device-test}.mjs` are throwaway
manual verification tools (`node scripts/<name>.mjs`) — not part of the build, safe to delete or
extend as needed. A few demo accounts/restaurants exist in the live project from this testing
(e.g. `browser-test-1@example.com`) — the user has said to leave that data as-is.
