// Phase 4 milestone test: simulate a second device by appending an op directly from Node
// (a genuinely separate process/client, not just a second browser tab) to the SAME restaurant
// the browser tab is connected to, and confirm it arrives there in real time.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => l.split('=').map((s) => s.trim())),
);

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({
  email: 'browser-test-1@example.com',
  password: 'test-password-123',
});
if (signInErr) throw new Error(`sign in failed: ${signInErr.message}`);
console.log('✓ signed in as browser-test-1@example.com');

const { data: membership, error: memErr } = await client
  .from('memberships')
  .select('restaurant_id')
  .eq('user_id', signInData.user.id)
  .single();
if (memErr) throw new Error(`membership lookup failed: ${memErr.message}`);
const restaurantId = membership.restaurant_id;
console.log(`  restaurant_id=${restaurantId}`);

const qty = Number(process.argv[2] ?? 77);
const { data: rows, error: appendErr } = await client.rpc('append_ops', {
  p_restaurant_id: restaurantId,
  p_client_id: 'node-second-device',
  p_ops: [
    {
      op_id: crypto.randomUUID(),
      action: { type: 'SET_INGREDIENT_QTY', id: 'ing-tomato', qty },
    },
  ],
});
if (appendErr) throw new Error(`append_ops failed: ${appendErr.message}`);
console.log(`✓ appended SET_INGREDIENT_QTY ing-tomato -> ${qty} as seq ${rows[0].seq}`);
console.log('\nNow check the browser tab — ing-tomato should update to this value live.');
