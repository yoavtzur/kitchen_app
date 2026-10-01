# Build history

> **This is a record of how things were built, not a map of the current code.** It was split out of
> `CLAUDE.md` so that file stays about how the code works *now*. Several entries name files that no
> longer exist: `Home.tsx` and `Tasks.tsx` became `Today.tsx` plus `src/screens/tasks/`,
> `Ingredients.tsx` was merged into `StockCount.tsx`, `MorningDashboard` became
> `screens/orders/MorningOrder.tsx`, and the "הרשאות צוות" / "טבחים" sections of `Settings.tsx` are now
> `screens/Team.tsx`. When this file and `CLAUDE.md` disagree, `CLAUDE.md` is current.

## Multi-device sync, built in phases (2026-09-06)

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

## The pre-launch audit (2026-09-30)

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
