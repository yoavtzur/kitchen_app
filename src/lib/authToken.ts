import { supabase } from './supabase';

/**
 * The current access token, for the one client call that needs to prove who is asking:
 * `/api/scan-recipe`.
 *
 * Kept in its own module so `geminiScanner.ts` stays free of the Supabase singleton — that file
 * is pure and unit-tested in node, and importing `supabase.ts` there would drag `createClient`
 * and `localStorage` into a test that has neither. The scanner takes a token as an argument
 * instead; this is how its one caller obtains one.
 *
 * Returns null in local mode (no client at all) and when nobody is signed in. The endpoint
 * answers 401 in both cases, which is correct: without an account there is no membership, and
 * without a membership there is no quota to draw on.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    // `getSession` refreshes an expired token when it can, so a cook who left the app open all
    // shift doesn't get a spurious 401 on the first scan after lunch.
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
