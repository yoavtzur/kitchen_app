# ניהול מטבח (Kitchen App)

A Hebrew-language (RTL), mobile-first kitchen management PWA for a restaurant: tracks raw-ingredient
and prepared-product inventory, recipes, a weekly/daily consumption plan, auto-derived daily prep
tasks, and a supply order sheet. Built with React, TypeScript, and Vite.

**Two modes, same app:** with no Supabase project configured, it's fully client-only — all state in
the browser's `localStorage`, no account, no network. With a Supabase project configured (see below),
every cook signs up, joins their restaurant with a 6-character code, and the whole app state syncs in
real time across every device at that restaurant, with an offline queue for bad kitchen wifi.

See [CLAUDE.md](./CLAUDE.md) for the full architecture writeup.

## Getting started

```bash
npm install
npm run dev
```

To run in multi-device sync mode instead of local-only, copy `.env.example` to `.env.local` and fill
in your Supabase project's URL and anon key.

## Scripts

```bash
npm run dev       # start the Vite dev server
npm run build     # tsc -b && vite build — the real build check, not just tests
npm run test      # vitest run (single run, not watch mode)
npm run lint      # oxlint
npm run preview   # preview a production build
```

## Deployment

`main` is production and deploys automatically via Vercel's Git integration on every push — see
CLAUDE.md's "Git & deployment" section for the branch workflow (work on a feature branch, merge to
`main` only once verified) and how the Supabase env vars are wired up in production.
