// One-off manual verification script — NOT part of the app or the build. Originally written for
// Phase 2 (create_restaurant / join_restaurant / append_ops / RLS isolation); extended to also
// verify the granular ABAC added by supabase/migrations/0003_rls_and_granular_roles.sql. That
// migration must already be applied to the project this script points at (see .env.local), since
// enforcement lives inside append_ops itself rather than RLS — this is the one check that proves
// the RPC boundary from OUTSIDE the UI, not just that React hides a button. Safe to delete after
// running once; throwaway test accounts/restaurant rows are left in the DB as harmless demo data.
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
const ownerEmail = `verify-owner-${stamp}@example.com`;
const memberEmail = `verify-member-${stamp}@example.com`;
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
  // --- Owner: sign up, create a restaurant with a seed snapshot ---
  const owner = client();
  await must('owner signUp', owner.auth.signUp({ email: ownerEmail, password }));
  if (!(await owner.auth.getSession()).data.session) {
    throw new Error('No session after signUp — is "Confirm email" still enabled? Disable it and retry.');
  }

  const seed = { schemaVersion: 3, hello: 'from verify-supabase.mjs' };
  const created = await must(
    'create_restaurant',
    owner.rpc('create_restaurant', { p_name: 'Verify Kitchen', p_snapshot: seed, p_schema_version: 3 }),
  );
  const { restaurant_id: restaurantId, join_code: joinCode } = created[0];
  console.log(`  restaurant_id=${restaurantId} join_code=${joinCode}`);

  // --- Owner appends two ops ---
  const appended = await must(
    'append_ops (owner, 2 ops)',
    owner.rpc('append_ops', {
      p_restaurant_id: restaurantId,
      p_client_id: 'verify-owner-device',
      p_ops: [
        { op_id: crypto.randomUUID(), action: { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 5 } },
        { op_id: crypto.randomUUID(), action: { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 9 } },
      ],
    }),
  );
  const seqs = appended.map((r) => r.seq);
  if (JSON.stringify(seqs) !== JSON.stringify([1, 2])) {
    throw new Error(`Expected seqs [1,2], got ${JSON.stringify(seqs)}`);
  }
  console.log(`  seqs=${JSON.stringify(seqs)} (contiguous, as expected)`);

  // --- A retried append of the SAME op_ids must be a no-op, not duplicate rows ---
  const retried = await must(
    'append_ops retry with identical op_ids (dedupe check)',
    owner.rpc('append_ops', {
      p_restaurant_id: restaurantId,
      p_client_id: 'verify-owner-device',
      p_ops: appended.map((r) => ({ op_id: r.op_id, action: r.action })),
    }),
  );
  if (retried.length !== 0) throw new Error(`Expected 0 rows on retry, got ${retried.length}`);
  console.log('  retry correctly inserted 0 new rows');

  // --- Member: sign up, join with the code ---
  const member = client();
  await must('member signUp', member.auth.signUp({ email: memberEmail, password }));
  const joined = await must('join_restaurant', member.rpc('join_restaurant', { p_code: joinCode }));
  if (joined[0].restaurant_id !== restaurantId) throw new Error('join_restaurant returned the wrong restaurant');

  // --- Member appends its own op; seq must continue from 3, not restart ---
  const memberAppend = await must(
    'append_ops (member, 1 op)',
    member.rpc('append_ops', {
      p_restaurant_id: restaurantId,
      p_client_id: 'verify-member-device',
      p_ops: [{ op_id: crypto.randomUUID(), action: { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 2 } }],
    }),
  );
  if (memberAppend[0].seq !== 3) throw new Error(`Expected seq 3, got ${memberAppend[0].seq}`);
  console.log('  member op got seq 3 — continues the SAME per-restaurant sequence as the owner');

  // --- A second device claiming to be a fresh account must NOT be able to read this restaurant ---
  const stranger = client();
  await must('stranger signUp', stranger.auth.signUp({ email: `verify-stranger-${stamp}@example.com`, password }));
  const { data: strangerOps, error: strangerErr } = await stranger
    .from('ops')
    .select('*')
    .eq('restaurant_id', restaurantId);
  if (strangerErr) throw new Error(`Unexpected error for stranger SELECT: ${strangerErr.message}`);
  if ((strangerOps ?? []).length !== 0) throw new Error(`RLS FAILED: stranger saw ${strangerOps.length} ops rows!`);
  console.log('✓ RLS check: a non-member sees 0 rows from ops for this restaurant');

  // --- Member can read the ops the owner wrote (membership grants visibility) ---
  const memberOps = await must(
    'member reads ops (should see all 3, via RLS)',
    member.from('ops').select('seq').eq('restaurant_id', restaurantId).order('seq'),
  );
  if (JSON.stringify(memberOps.map((r) => r.seq)) !== JSON.stringify([1, 2, 3])) {
    throw new Error(`Expected member to see seqs [1,2,3], got ${JSON.stringify(memberOps)}`);
  }
  console.log('  member sees seqs [1,2,3] — full log visible to a teammate');

  // --- Granular ABAC (0003_rls_and_granular_roles.sql): enforcement lives inside append_ops
  // itself, not RLS (there's no recipes table). This is the one check that can't be trusted
  // from the UI alone — it proves the RPC boundary rejects/accepts based on the DB row, not
  // anything the client claims.
  const memberSession = (await member.auth.getSession()).data.session;
  const memberUserId = memberSession.user.id;

  const updateRecipeAction = {
    type: 'UPDATE_RECIPE',
    recipe: {
      id: 'recipe-verify-abac',
      name: 'ABAC Test Recipe',
      category: 'general',
      yieldQty: 1,
      yieldUnit: 'unit',
      items: [],
      steps: [],
    },
  };

  // A plain cook (no can_edit_recipes yet) must be rejected with 42501.
  const { data: forbiddenData, error: forbiddenErr } = await member.rpc('append_ops', {
    p_restaurant_id: restaurantId,
    p_client_id: 'verify-member-device',
    p_ops: [{ op_id: crypto.randomUUID(), action: updateRecipeAction }],
  });
  if (!forbiddenErr) {
    throw new Error(`Expected UPDATE_RECIPE to be rejected for a cook with no flags, but it succeeded: ${JSON.stringify(forbiddenData)}`);
  }
  if (forbiddenErr.code !== '42501') {
    throw new Error(`Expected error code 42501, got ${forbiddenErr.code}: ${forbiddenErr.message}`);
  }
  console.log('✓ ABAC: cook with no can_edit_recipes is rejected (42501) on UPDATE_RECIPE');

  // Chef grants the cook edit-recipes permission via set_member_permissions.
  await must(
    'set_member_permissions (grant can_edit_recipes)',
    owner.rpc('set_member_permissions', {
      p_user_id: memberUserId,
      p_role: 'cook',
      p_can_edit_recipes: true,
      p_can_delete_recipes: false,
    }),
  );
  console.log('  granted can_edit_recipes to the cook');

  // The SAME call must now succeed with a fresh op_id (the earlier op_id was never inserted).
  const allowed = await must(
    'append_ops (cook, UPDATE_RECIPE, now permitted)',
    member.rpc('append_ops', {
      p_restaurant_id: restaurantId,
      p_client_id: 'verify-member-device',
      p_ops: [{ op_id: crypto.randomUUID(), action: updateRecipeAction }],
    }),
  );
  if (allowed.length !== 1) throw new Error(`Expected 1 row appended, got ${allowed.length}`);
  console.log('  UPDATE_RECIPE succeeded once can_edit_recipes was granted');

  // can_edit_recipes does NOT imply can_delete_recipes — DELETE_RECIPE must still be rejected.
  const { error: deleteErr } = await member.rpc('append_ops', {
    p_restaurant_id: restaurantId,
    p_client_id: 'verify-member-device',
    p_ops: [{ op_id: crypto.randomUUID(), action: { type: 'DELETE_RECIPE', id: 'recipe-verify-abac' } }],
  });
  if (!deleteErr) throw new Error('Expected DELETE_RECIPE to be rejected (can_delete_recipes not granted), but it succeeded');
  if (deleteErr.code !== '42501') throw new Error(`Expected 42501 for DELETE_RECIPE, got ${deleteErr.code}: ${deleteErr.message}`);
  console.log('✓ ABAC: can_edit_recipes does not imply can_delete_recipes — DELETE_RECIPE still rejected (42501)');

  // A cook (even with both flags) cannot call reset_snapshot or set_member_permissions — chef-only.
  const { error: resetErr } = await member.rpc('reset_snapshot', {
    p_restaurant_id: restaurantId,
    p_snapshot: { schemaVersion: 4 },
    p_schema_version: 4,
  });
  if (!resetErr) throw new Error('Expected reset_snapshot to be rejected for a cook, but it succeeded');
  if (resetErr.code !== '42501') throw new Error(`Expected 42501 for reset_snapshot, got ${resetErr.code}: ${resetErr.message}`);
  console.log('✓ ABAC: a cook cannot call reset_snapshot (chef-only), rejected with 42501');

  const { error: setPermErr } = await member.rpc('set_member_permissions', {
    p_user_id: memberUserId,
    p_role: 'chef',
    p_can_edit_recipes: true,
    p_can_delete_recipes: true,
  });
  if (!setPermErr) throw new Error('Expected set_member_permissions to be rejected for a cook, but it succeeded');
  if (setPermErr.code !== '42501') throw new Error(`Expected 42501 for set_member_permissions, got ${setPermErr.code}: ${setPermErr.message}`);
  console.log('✓ ABAC: a cook cannot call set_member_permissions (chef-only), rejected with 42501');

  // The chef (owner) passes every restricted action unconditionally, flags or not.
  const chefAppend = await must(
    'append_ops (chef, DELETE_RECIPE — always permitted)',
    owner.rpc('append_ops', {
      p_restaurant_id: restaurantId,
      p_client_id: 'verify-owner-device',
      p_ops: [{ op_id: crypto.randomUUID(), action: { type: 'DELETE_RECIPE', id: 'recipe-verify-abac' } }],
    }),
  );
  if (chefAppend.length !== 1) throw new Error(`Expected 1 row appended, got ${chefAppend.length}`);
  console.log('  chef DELETE_RECIPE succeeded with no flags needed');

  console.log('\nAll checks passed. ✅');
  console.log(`\n(Test rows left in the DB under restaurant_id=${restaurantId}; harmless demo data — delete manually if you'd like.)`);
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exit(1);
});
