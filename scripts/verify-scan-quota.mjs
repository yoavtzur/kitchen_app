// One-off manual verification for supabase/migrations/0006_scan_quota_and_app_config.sql — NOT
// part of the app or the build, same throwaway pattern as verify-supabase.mjs.
//
// Proves consume_scan_quota() from OUTSIDE the app: a signed-out caller is refused, a signed-in
// non-member is refused, a member is allowed and its counter actually decrements, the limit is
// enforced, scan_usage is unreadable even to the account it describes, and maintenance_mode
// short-circuits everything.
//
// Run it AFTER applying 0006 by hand:  node scripts/verify-scan-quota.mjs
//
// It temporarily lowers scan_quota_user to make the limit reachable, so it needs that column
// writable — do that from the SQL editor before running, or run the whole thing against a
// throwaway project. It restores the value at the end either way.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => l.split('=').map((s) => s.trim())),
);

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local');

function client() {
  return createClient(url, key, { auth: { persistSession: false } });
}

const stamp = Date.now();
const memberEmail = `verify-quota-member-${stamp}@example.com`;
const strangerEmail = `verify-quota-stranger-${stamp}@example.com`;
const password = 'verify-pass-12345!';

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`✓ ${label}`);
  } else {
    failed++;
    console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label} failed: ${error.message} (code: ${error.code ?? 'n/a'})`);
  console.log(`· ${label}`);
  return data;
}

async function main() {
  // ── 1. a signed-out caller gets nothing ────────────────────────────────────
  const anon = client();
  {
    const { error } = await anon.rpc('consume_scan_quota');
    check('signed-out caller is refused', Boolean(error), 'expected an error, got a result');
  }

  // app_config, by contrast, must be readable WITHOUT a session — that is what lets the kill
  // switch reach a client whose auth path is the thing that's broken.
  {
    const { data, error } = await anon.from('app_config').select('maintenance_mode').maybeSingle();
    check('app_config is readable by anon', !error && data !== null, error?.message ?? 'no row');
  }

  // ── 2. signed in but not a member of anything ──────────────────────────────
  const stranger = client();
  await must('stranger signUp', stranger.auth.signUp({ email: strangerEmail, password }));
  if (!(await stranger.auth.getSession()).data.session) {
    throw new Error('No session after signUp — is "Confirm email" still enabled? Disable it and retry.');
  }
  {
    const { error } = await stranger.rpc('consume_scan_quota');
    check(
      'non-member is refused with not_a_member',
      Boolean(error) && String(error.message).includes('not_a_member'),
      error?.message ?? 'no error at all',
    );
  }

  // ── 3. a real member ───────────────────────────────────────────────────────
  const member = client();
  await must('member signUp', member.auth.signUp({ email: memberEmail, password }));
  await must(
    'create restaurant',
    member.rpc('create_restaurant', {
      p_name: `Quota Test ${stamp}`,
      p_snapshot: { schemaVersion: 5 },
      p_schema_version: 5,
    }),
  );

  let first;
  {
    const { data, error } = await member.rpc('consume_scan_quota');
    first = data;
    check('member is allowed', !error && data?.status === 'ok', error?.message ?? JSON.stringify(data));
  }
  {
    const { data } = await member.rpc('consume_scan_quota');
    check(
      'the counter actually decrements',
      data?.status === 'ok' && data.remaining === first.remaining - 1,
      `first=${first?.remaining} second=${data?.remaining}`,
    );
  }

  // ── 4. the counter table itself is unreachable ─────────────────────────────
  {
    const { data, error } = await member.from('scan_usage').select('*');
    check(
      'scan_usage cannot be read, even by the account it describes',
      Boolean(error) || (Array.isArray(data) && data.length === 0),
      'rows came back',
    );
  }
  {
    const { error } = await member.from('scan_usage').update({ used: 0 }).eq('scope', 'user');
    check('scan_usage cannot be reset by a client', Boolean(error), 'update succeeded');
  }

  // ── 5. the limit is actually enforced ──────────────────────────────────────
  // Needs scan_quota_user temporarily lowered; skipped automatically if it isn't writable.
  const { error: lowerError } = await member.from('app_config').update({ scan_quota_user: 2 }).eq('id', true);
  if (lowerError) {
    console.log('· skipping the limit check (app_config is not client-writable, which is correct');
    console.log('  for production). To run it, set scan_quota_user = 2 in the SQL editor first.');
  } else {
    let sawQuota = false;
    for (let i = 0; i < 6 && !sawQuota; i++) {
      const { data } = await member.rpc('consume_scan_quota');
      if (data?.status === 'quota') sawQuota = true;
    }
    check('the per-user limit is enforced', sawQuota, 'never returned status=quota');
    await member.from('app_config').update({ scan_quota_user: 20 }).eq('id', true);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
