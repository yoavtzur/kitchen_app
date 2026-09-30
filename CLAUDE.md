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

There are 20 test files (278 tests), colocated in `__tests__` folders next to what they cover:
`src/lib/__tests__/` (calc, date, ids, integrity, tasks, swipe, units-adjacent helpers, geminiScanner,
recipeDraft, migrateStations, sentry, appConfig, focusTrap), `src/store/__tests__/{reducer,storage}.test.ts`,
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
column counts at each breakpoint. They need `npm install --no-save playwright` (deliberately not a
dependency) and a dev server; each file's header says exactly how to run it.

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

**Supabase schema**: `supabase/migrations/0001_init.sql` through `0006_scan_quota_and_app_config.sql`,
**all applied by hand to the live project**. Nothing in the build applies migrations, so any *future*
migration needs the same manual step before synced clients can use it — until then they sit at
`upgrade-required` and refuse to append, which is the expected signal that it hasn't landed yet.
`LAUNCH-CHECKLIST.md` at the repo root is the operator-facing version of this.

Core tables: `restaurants` (name, `join_code`, `last_seq`, `snapshot_seq`), `snapshots` (the big jsonb
blob, kept off `restaurants` so that table stays realtime-cheap), `memberships` (`user_id` ⇄
`restaurant_id` ⇄ `cook_id` ⇄ role + permission flags, one restaurant per user in v1), `ops`
(append-only, `seq` allocated from `restaurants.last_seq` under a row lock inside `append_ops` —
**a per-restaurant contiguous sequence, not a `bigserial`**, because gap detection is meaningless over
a sequence with holes). Plus `app_config` (the kill switch, one row) and `scan_usage` (three daily
counters; **RLS on with no policy and no grant at all**, so a client can neither read its own counter
nor reset it — `consume_scan_quota()` is the only reachable path).

RLS is SELECT-only everywhere; every write is a `SECURITY DEFINER` RPC (`create_restaurant`,
`join_restaurant`, `append_ops`, `set_my_cook`, `reset_snapshot`, `compact_snapshot`,
`set_member_permissions`, `remove_member`, `consume_scan_quota`), because RLS alone can't express
"insert only once you're already a member", "allocate the next seq under a lock", or "count and judge
a quota atomically".

`scripts/{verify-supabase,check-ops,second-device-test,verify-remove-member,verify-scan-quota}.mjs` are
manual, throwaway verification tools against the live project — not part of the app or the build.
`scripts/{verify-a11y-ui,verify-auth-forms}.mjs` are the same idea against a local dev server and a
real browser instead (see "Commands" above).

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
`AuthGate` → `MembershipGate` → `MaintenanceGate` → `AppProvider` → `CookGate` → `SentryContext` +
`SyncBadge` + `Routes` + `BottomNav`. `BottomNav` and `SyncBadge` only ever mount once every gate has
passed, and are siblings of `<Routes>` so a route boundary can never take them down.

Screens live flat in `src/screens/` (app screens plus `Auth.tsx`/`Onboarding.tsx`), except the task UI,
which is split under `src/screens/tasks/` (`TaskRow`, `TaskDetailSheet`, `AddManualTaskSheet`,
`completeTask`). Shared UI lives in `src/components/`. Every screen except `Today` is lazily loaded via
`src/routes.tsx`; `Today` stays eager because it is the PWA's `start_url` and the target of the `/`
redirect.

**`Today.tsx` is the landing screen and the whole core loop.** It replaced Home and Tasks, which were
two screens showing the same list — Home was read-only and every card on it merely navigated to Tasks,
so a cook saw their work twice before touching it once. `/` redirects to `/tasks` (same pattern
`/ingredients` → `/count` already used), which also retires the `NavLink to="/" end` footgun.

`BottomNav` slots: **משימות** (with an open-task badge) · מצרכים (`/count`) · בוקר · מתכונים ·
הזמנות · עוד. Anything else (Settings, Consumption) is under "עוד". The Ingredients slot routes to
`/count` — `StockCount.tsx` is both the ingredient database and the stock-count walk-through (see
below); there is no separate `/ingredients` screen.

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
  (`StockCount`, `MorningDashboard`, `Settings`'s member removal). These used to render in document
  flow — on `StockCount` that put "הספירה נשמרה ✓" *below a full ingredient table*, off the bottom
  of the document, where the cook who just tapped the sticky save bar never saw it. `role="status"`
  because a message that appears silently and removes itself is invisible to a screen reader, and
  "did that save?" is the question it exists to answer.

The strip above the bottom nav now holds three things — `.sync-badge` (start edge), `.count-save-bar`
(centered) and `.toast`. The toast clears the save bar rather than sitting beside it, because on both
screens that render one the two are driven by the same tap: the bar is the control, the toast is its
answer, and a toast drawn over it would cover what it is confirming. `--save-bar-height` in
`tokens.css` is what keeps those two rules agreeing.

### Tablet, focus, motion

Three rules at the bottom of `global.css`, each fixing something that was invisible on the phone
this app was built against:

- **Breakpoints at 768/1024px.** `--content-max` (720 → 900 → 1040) is the single width every
  consumer reads — `.app-main`, `.sheet`, `.count-save-bar`'s button and `.bottom-nav` — because a
  breakpoint that widened three of the four would put the nav out of line with the content above it.
  `.tasks-grid` goes 2 → 3 → 4 columns, since "how many prep tasks fit without scrolling" is what
  the extra width is *for*. `.keypad-grid`, `.stat-grid` and `.weekday-usage-grid` deliberately do
  not move — a keypad is a keypad, there are three stats, and there are seven weekdays. Note that
  `.tasks-grid`'s trailing-card full-row stretch is written for exactly two columns
  (`:last-child:nth-child(odd)` means "alone on its row" only when rows hold two) and is reset above
  768px rather than re-derived per column count.
- **A global `:focus-visible` ring.** There was exactly one focus rule in the whole stylesheet, which
  was fine while every control was touch-only and a real hole the moment phase 4 gave the completion
  checkbox a keyboard path — `body` sets `-webkit-tap-highlight-color: transparent`, so nothing else
  was left to show focus either. `:focus-visible` rather than `:focus`, and `outline` rather than a
  border or box-shadow so it never reflows what it is on.
- **`prefers-reduced-motion`.** Everything animated in this app is decoration (the pulsing priority
  dot, the drifting blobs, the wiggling mascot, the skeleton's shimmer) and none of it carries
  information the colour or shape doesn't, so it all simply stops. Transitions are cut to ~0 rather
  than to `0s`, because a few of them are `:active` feedback a cook does rely on feeling.

### Security headers and the service worker — the bits `vercel.json` can't comment on

`vercel.json` is JSON, so it carries no comments; the reasoning for what's in it lives here.

**CSP.** `script-src 'self'` works because the production build emits no inline script —
`vite-plugin-pwa` is configured with `injectRegister: null` and `UpdatePrompt.tsx` registers the
worker from app code instead. `style-src` needs `'unsafe-inline'` and always will: this codebase
uses React `style={{…}}` attributes on almost every screen. `connect-src` covers Supabase over
both https and wss plus `*.sentry.io`; **Phase 7's PostHog will need adding here**, and a missing
entry fails as a silent network error, not a build error. `https://vercel.live` (and the
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

---

## ⚠ Continuing this work: the pre-launch audit (2026-09-30)

A second, separate track from the sync work above: getting the app to a state where it can be handed
to a real restaurant crew — no white screen mid-shift, no torched Gemini account, no irreversible data
loss. Run as ordered phases, **one PR per phase, each verified live and merged only on explicit
approval in chat**. The architecture sections above describe what each landed; this is the status.

**Done — phases 1 to 5:**

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

**Not started — phases 6 and 7**, in the order the plan sets:

6. **Privacy, accounts, bots.** `delete_my_account()` + the Edge Function, `rotate_join_code()`,
   rate-limiting `join_restaurant` (6 chars from a 32-char alphabet with no limit today — reuse
   `scan_usage` with a fourth scope, which needs its `scope` check constraint widened), legal docs
   outside every gate, Turnstile on signup via Supabase's native support, and **import validation**:
   `parseImportedState` currently falls through to `return parsed` for any unrecognized version, so
   `{"schemaVersion":5}` "imports successfully" and wipes a restaurant.
7. **CI, analytics, process.** There is no `.github/` directory at all. PostHog with
   `autocapture: false` — non-negotiable, since `$el_text` would capture the visible text of every
   clicked element, which in this app is ingredient, recipe, cook and task names. Supabase CLI so
   migrations stop being manual paste. **PostHog also needs adding to `connect-src` in `vercel.json`**,
   where a missing entry fails as a silent network error rather than a build error.

**Environment reminder:** this dev machine already has a working `.env.local` — running
`npm run dev` here exercises real Supabase auth, not local mode. Use
`localStorage.setItem('kitchen-force-local','1')` in the browser to get local-only behavior back
for a quick check. `scripts/{verify-supabase,check-ops,second-device-test,verify-remove-member}.mjs` are throwaway
manual verification tools (`node scripts/<name>.mjs`) — not part of the build, safe to delete or
extend as needed; `scripts/{verify-a11y-ui,verify-auth-forms}.mjs` are the browser-driving ones
added in phase 5 and need `npm install --no-save playwright` first. A few demo accounts/restaurants exist in the live project from this testing
(e.g. `browser-test-1@example.com`) — the user has said to leave that data as-is.
