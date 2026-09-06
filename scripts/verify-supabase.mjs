// One-off manual verification script for Phase 2 — NOT part of the app or the build.
// Signs up two throwaway test accounts and exercises create_restaurant / join_restaurant /
// append_ops end to end, printing what happened. Safe to delete after running once.
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

  console.log('\nAll checks passed. ✅');
  console.log(`\n(Test rows left in the DB under restaurant_id=${restaurantId}; harmless demo data — delete manually if you'd like.)`);
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exit(1);
});
