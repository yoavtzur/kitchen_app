// One-off manual verification script for supabase/migrations/0005_remove_member.sql — NOT part
// of the app or the build, same throwaway pattern as verify-supabase.mjs. Proves the remove_member
// RPC from OUTSIDE the UI: chef-only, can't remove self, actually deletes the membership row, and
// a removed member's own membership read comes back empty (what MembershipGate relies on to bounce
// them to Onboarding). Safe to delete after running once; leftover test accounts/restaurant rows
// are harmless demo data.
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
const chefEmail = `verify-rm-chef-${stamp}@example.com`;
const cookEmail = `verify-rm-cook-${stamp}@example.com`;
const password = 'verify-pass-12345!';

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    throw new Error(
      `${label} failed: ${error.message} (code: ${error.code ?? 'n/a'}, details: ${error.details ?? 'n/a'}, hint: ${error.hint ?? 'n/a'})`,
    );
  }
  console.log(`✓ ${label}`);
  return data;
}

async function main() {
  const chef = client();
  await must('chef signUp', chef.auth.signUp({ email: chefEmail, password }));
  if (!(await chef.auth.getSession()).data.session) {
    throw new Error('No session after signUp — is "Confirm email" still enabled? Disable it and retry.');
  }

  const seed = { schemaVersion: 4, hello: 'from verify-remove-member.mjs' };
  const created = await must(
    'create_restaurant',
    chef.rpc('create_restaurant', { p_name: 'Verify RM Kitchen', p_snapshot: seed, p_schema_version: 4 }),
  );
  const { restaurant_id: restaurantId, join_code: joinCode } = created[0];
  console.log(`  restaurant_id=${restaurantId} join_code=${joinCode}`);

  const cook = client();
  await must('cook signUp', cook.auth.signUp({ email: cookEmail, password }));
  const joined = await must('join_restaurant', cook.rpc('join_restaurant', { p_code: joinCode }));
  if (joined[0].restaurant_id !== restaurantId) throw new Error('join_restaurant returned the wrong restaurant');

  const cookSession = (await cook.auth.getSession()).data.session;
  const cookUserId = cookSession.user.id;
  const chefSession = (await chef.auth.getSession()).data.session;
  const chefUserId = chefSession.user.id;

  // --- A cook cannot remove anyone (chef-only) ---
  const { error: cookForbidden } = await cook.rpc('remove_member', { p_user_id: chefUserId });
  if (!cookForbidden) throw new Error('Expected a cook calling remove_member to be rejected, but it succeeded');
  if (cookForbidden.code !== '42501') throw new Error(`Expected 42501, got ${cookForbidden.code}: ${cookForbidden.message}`);
  console.log('✓ a cook cannot call remove_member (chef-only), rejected with 42501');

  // --- A chef cannot remove themself ---
  const { error: selfErr } = await chef.rpc('remove_member', { p_user_id: chefUserId });
  if (!selfErr) throw new Error('Expected remove_member on self to be rejected, but it succeeded');
  if (selfErr.code !== '42501' || !selfErr.message.includes('cannot_remove_self')) {
    throw new Error(`Expected 42501/cannot_remove_self, got ${selfErr.code}: ${selfErr.message}`);
  }
  console.log('✓ a chef cannot remove themself, rejected with cannot_remove_self (42501)');

  // --- Removing someone not a member of this restaurant fails with no_such_member ---
  const { error: noSuchErr } = await chef.rpc('remove_member', { p_user_id: crypto.randomUUID() });
  if (!noSuchErr) throw new Error('Expected remove_member on a non-member uuid to be rejected, but it succeeded');
  if (noSuchErr.code !== 'P0002') throw new Error(`Expected P0002, got ${noSuchErr.code}: ${noSuchErr.message}`);
  console.log('✓ removing a non-member uuid is rejected with no_such_member (P0002)');

  // --- The real removal: chef removes the cook ---
  await must('remove_member (chef removes cook)', chef.rpc('remove_member', { p_user_id: cookUserId }));

  const remaining = await must(
    'chef reads memberships after removal',
    chef.from('memberships').select('user_id').eq('restaurant_id', restaurantId),
  );
  if (remaining.some((r) => r.user_id === cookUserId)) throw new Error('Cook membership row still present after remove_member!');
  if (remaining.length !== 1 || remaining[0].user_id !== chefUserId) {
    throw new Error(`Expected exactly the chef's own row to remain, got ${JSON.stringify(remaining)}`);
  }
  console.log('  membership row is gone — only the chef remains');

  // --- The removed cook's own membership read now comes back empty (what MembershipGate uses) ---
  const cookOwnRow = await must(
    'removed cook reads their own membership (should be empty)',
    cook.from('memberships').select('restaurant_id').eq('user_id', cookUserId),
  );
  if (cookOwnRow.length !== 0) throw new Error(`Expected 0 rows for the removed cook, got ${JSON.stringify(cookOwnRow)}`);
  console.log('✓ removed cook now sees zero membership rows — MembershipGate will bounce them to Onboarding');

  // --- Removing the same user again fails with no_such_member (already gone) ---
  const { error: alreadyGoneErr } = await chef.rpc('remove_member', { p_user_id: cookUserId });
  if (!alreadyGoneErr) throw new Error('Expected re-removing an already-removed member to be rejected, but it succeeded');
  if (alreadyGoneErr.code !== 'P0002') throw new Error(`Expected P0002, got ${alreadyGoneErr.code}: ${alreadyGoneErr.message}`);
  console.log('✓ re-removing an already-removed member fails with no_such_member (P0002), not a silent no-op');

  console.log('\nAll checks passed. ✅');
  console.log(`\n(Test rows left in the DB under restaurant_id=${restaurantId}; harmless demo data — delete manually if you'd like.)`);
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exit(1);
});
