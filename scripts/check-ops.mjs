import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((s) => s.trim())),
);
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
await client.auth.signInWithPassword({ email: 'browser-test-1@example.com', password: 'test-password-123' });
const { data } = await client.from('memberships').select('restaurant_id').single();
const { data: ops } = await client
  .from('ops')
  .select('seq, op_id, action, client_id')
  .eq('restaurant_id', data.restaurant_id)
  .order('seq');
console.log(JSON.stringify(ops, null, 2));
