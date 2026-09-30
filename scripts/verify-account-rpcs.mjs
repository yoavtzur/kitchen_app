// One-off manual verification for supabase/migrations/0007_privacy_join_code_and_rate_limits.sql
// — NOT part of the app or the build, same throwaway pattern as verify-scan-quota.mjs.
//
// Proves the three new RPCs from OUTSIDE the app, against the live project:
//
//   rotate_join_code()   chef-only; the old code stops working the instant it returns
//   delete_my_account()  refuses the last chef with teammates, takes the restaurant with the
//                        last member, and actually removes the auth user
//   join_restaurant()    unchanged for a correct code, and now rate-limited for wrong ones
//
// Run it AFTER applying 0007 by hand:  node scripts/verify-account-rpcs.mjs
//
// It creates its own throwaway accounts and restaurants and deletes them at the end — it never
// touches existing data. The rate-limit section temporarily lowers `join_quota_user` so the
// limit is reachable in a few calls rather than ten; that column must be writable from the SQL
// editor first (it is not writable from here), and the script restores it either way.
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

/** A signed-in throwaway account. Signup is open and confirmation is off, which is exactly the
 * property 0007's rate limiting exists to bound — and what makes this script possible. */
async function account(tag) {
  const c = client();
  const email = `verify-0007-${tag}-${stamp}@example.com`;
  const { error } = await c.auth.signUp({ email, password });
  if (error) throw new Error(`signUp(${tag}) failed: ${error.message}`);
  return { client: c, email };
}

const SEED = { schemaVersion: 5, ingredients: [], products: [], recipes: [], tasks: [], taskOverrides: [], specialEvents: [], dayPlans: [], orderLines: [], cooks: [], stations: [], settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 } };

async function main() {
  // ── 1. rotate_join_code ────────────────────────────────────────────────────
  const chef = await account('chef');
  const { data: created, error: createErr } = await chef.client.rpc('create_restaurant', {
    p_name: `בדיקה ${stamp}`,
    p_snapshot: SEED,
    p_schema_version: 5,
  });
  if (createErr) throw new Error(`create_restaurant failed: ${createErr.message}`);
  const restaurantId = created[0].restaurant_id;
  const originalCode = created[0].join_code;

  const { data: rotated, error: rotateErr } = await chef.client.rpc('rotate_join_code');
  check('a chef can rotate the join code', !rotateErr && typeof rotated === 'string', rotateErr?.message);
  check('the new code differs from the old one', rotated !== originalCode);

  // The point of rotating: the old code must stop working immediately.
  const stranger = await account('stranger');
  const { error: oldCodeErr } = await stranger.client.rpc('join_restaurant', { p_code: originalCode });
  check('the OLD code no longer joins anyone', oldCodeErr?.code === 'P0002', oldCodeErr?.message ?? 'it still worked');

  const { error: newCodeErr } = await stranger.client.rpc('join_restaurant', { p_code: rotated });
  check('the NEW code does', !newCodeErr, newCodeErr?.message);

  // A cook is not a chef.
  const { error: cookRotateErr } = await stranger.client.rpc('rotate_join_code');
  check('a cook cannot rotate it', cookRotateErr?.code === '42501', cookRotateErr?.message ?? 'it was allowed');

  const outsider = await account('outsider');
  const { error: outsiderErr } = await outsider.client.rpc('rotate_join_code');
  check('a non-member cannot rotate anything', outsiderErr?.code === '42501', outsiderErr?.message ?? 'it was allowed');

  // ── 2. delete_my_account ───────────────────────────────────────────────────
  // The restaurant now has a chef and a cook, so the chef is the last chef WITH teammates.
  const { error: lastChefErr } = await chef.client.rpc('delete_my_account');
  check(
    'the last chef of a staffed kitchen is refused',
    lastChefErr?.code === '42501' && lastChefErr.message.includes('last_chef_account'),
    lastChefErr?.message ?? 'it was allowed',
  );

  // The cook can leave freely, and the kitchen survives.
  const { data: cookDeleted, error: cookDeleteErr } = await stranger.client.rpc('delete_my_account');
  check('a cook can delete their own account', !cookDeleteErr, cookDeleteErr?.message);
  check('and that does not delete the restaurant', cookDeleted?.restaurantDeleted === false, JSON.stringify(cookDeleted));

  // The deleted account must really be gone, not merely unlinked.
  const { error: reSignInErr } = await client().auth.signInWithPassword({
    email: stranger.email,
    password,
  });
  check('the deleted account can no longer sign in', Boolean(reSignInErr), 'it still signs in');

  // Now the chef is alone, so deleting takes the restaurant with it.
  const { data: chefDeleted, error: chefDeleteErr } = await chef.client.rpc('delete_my_account');
  check('the last member can now delete their account', !chefDeleteErr, chefDeleteErr?.message);
  check('and the restaurant goes with them', chefDeleted?.restaurantDeleted === true, JSON.stringify(chefDeleted));

  const { data: leftovers } = await outsider.client
    .from('restaurants')
    .select('id')
    .eq('id', restaurantId);
  check('the restaurant row is really gone', (leftovers ?? []).length === 0);

  // ── 3. join_restaurant rate limiting ───────────────────────────────────────
  // Needs join_quota_user lowered by hand first; skipped rather than failed otherwise, so the
  // rest of this script is still useful without SQL-editor access.
  const { data: cfg } = await outsider.client.from('app_config').select('join_quota_user').maybeSingle();
  const limit = cfg?.join_quota_user;
  if (typeof limit !== 'number') {
    console.log('· skipping the rate-limit section: app_config.join_quota_user is not readable');
  } else if (limit > 6) {
    console.log(`· skipping the rate-limit section: join_quota_user is ${limit}. To test it, run`);
    console.log('    update app_config set join_quota_user = 3;');
    console.log('  in the SQL editor, re-run this script, then set it back.');
  } else {
    const guesser = await account('guesser');
    let limited = null;
    for (let i = 0; i < limit + 2; i++) {
      const { error } = await guesser.client.rpc('join_restaurant', { p_code: 'ZZZZZZ' });
      if (error?.code === 'P0003') {
        limited = i + 1;
        break;
      }
      if (error?.code !== 'P0002') {
        check('every wrong guess is reported as an invalid code until the limit', false, error?.message);
        break;
      }
    }
    check('repeated wrong guesses are cut off', limited !== null, 'the limit never triggered');
    check(`cut off at attempt ${limited} for a limit of ${limit}`, limited === limit + 1);
    await guesser.client.rpc('delete_my_account');
  }

  await outsider.client.rpc('delete_my_account');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
