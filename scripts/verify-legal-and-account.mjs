/**
 * Manual browser check for the pre-launch audit's phase 6. Not part of the build or `npm test` —
 * this codebase tests pure functions in node on purpose (see CLAUDE.md), and everything below is
 * the class of thing that constraint leaves unverifiable: whether a route renders *above* the
 * auth gate, whether the bottom nav survives a navigation, whether a dialog's confirm button is
 * actually disabled.
 *
 *   npm install --no-save playwright      # not a dependency; the container already has Chromium
 *   node scripts/verify-legal-and-account.mjs
 *
 * Unlike the phase 5 scripts this starts its own dev servers — two of them, because the two
 * halves need opposite configurations:
 *
 *   • port 5175, with *placeholder* Supabase env vars, so `isSupabaseConfigured` is true and
 *     `AuthGate` renders the sign-in screen. That is the only way to prove the legal routes sit
 *     outside the gate rather than merely existing. The placeholders never reach the network:
 *     every assertion here is about what renders before any request resolves.
 *   • port 5176, in local mode, for the parts that need to be *inside* the app (the layout
 *     route, the import dialogs, the nav).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

/** Registered on `exit` as well as called explicitly at the end: a check that throws would
 * otherwise leave both servers holding their ports, and the *next* run fails on "port already in
 * use" rather than on the thing that actually broke. */
const servers = [];
function stopServers() {
  for (const server of servers.splice(0)) {
    try {
      process.kill(-server.pid);
    } catch {
      // already gone
    }
  }
}
process.on('exit', stopServers);
for (const signal of ['SIGINT', 'SIGTERM', 'uncaughtException']) {
  process.on(signal, (err) => {
    stopServers();
    if (err) console.error(err);
    process.exit(1);
  });
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** `detached` so the whole process group can be killed at the end: `npx` spawns a shell which
 * spawns vite, and killing only the npx pid leaves vite holding the port — which then makes the
 * *next* run of this script fail on "port already in use". */
function startServer(port, env) {
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  servers.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite on ${port} did not start`)), 30000);
    child.stdout.on('data', (buf) => {
      if (buf.toString().includes('ready in') || buf.toString().includes('Local:')) {
        clearTimeout(timer);
        setTimeout(() => resolve(child), 600);
      }
    });
    child.stderr.on('data', (b) => process.stderr.write(b));
  });
}

await startServer(5175, {
  VITE_SUPABASE_URL: 'https://placeholder.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'placeholder-anon-key',
});
await startServer(5176, {
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
});

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// ── part A: the legal routes render outside every gate ───────────────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const thirdParty = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) thirdParty.push(r.url());
  });

  await page.goto('http://localhost:5175/#/tasks');
  await page.waitForSelector('.screen-title', { timeout: 15000 });
  const gatedTitle = await page.textContent('.screen-title');
  check('with Supabase configured and no session, the app is gated', gatedTitle.includes('ניהול מטבח'));
  check('the gated screen is the sign-in form, not the app', (await page.locator('input[type="password"]').count()) === 1);
  check('the bottom nav never renders behind the gate', (await page.locator('.bottom-nav').count()) === 0);

  // The whole point of the layout route: this path must not reach AuthGate at all.
  await page.goto('http://localhost:5175/#/legal/privacy');
  await page.waitForSelector('.screen-title');
  check(
    'the privacy notice renders with no session',
    (await page.textContent('.screen-title')) === 'מדיניות פרטיות',
  );
  const body = await page.textContent('body');
  check('it names Gemini as the third party a scanned photo reaches', body.includes('Gemini'));
  check('it states there is no analytics or tracking', body.includes('אין באפליקציה מדידת שימוש'));
  check('no password field is on screen — this is not the gate', (await page.locator('input[type="password"]').count()) === 0);

  await page.goto('http://localhost:5175/#/legal/terms');
  await page.waitForSelector('.screen-title');
  check('the terms render with no session', (await page.textContent('.screen-title')) === 'תנאי שימוש');

  // Reachable by link, not only by typing a URL.
  await page.goto('http://localhost:5175/#/tasks');
  await page.waitForSelector('input[type="password"]');
  await page.getByRole('link', { name: 'מדיניות הפרטיות' }).click();
  await page.waitForSelector('.screen-title');
  check(
    'the sign-in screen links to the notice',
    (await page.textContent('.screen-title')) === 'מדיניות פרטיות',
  );

  await page.getByRole('link', { name: 'חזרה לאפליקציה' }).click();
  await page.waitForSelector('input[type="password"]', { timeout: 5000 }).then(
    () => check('"back to the app" returns to the gate rather than past it', true),
    () => check('"back to the app" returns to the gate rather than past it', false),
  );

  check(
    'Turnstile is dormant: no request to challenges.cloudflare.com',
    !thirdParty.some((u) => u.includes('challenges.cloudflare.com')),
    thirdParty.length ? `other third-party requests: ${thirdParty.length}` : 'no third-party requests at all',
  );
  check('the sign-in screen renders no captcha widget', (await page.locator('iframe').count()) === 0);
  await ctx.close();
}

// ── part B: the layout route, and the import path ────────────────────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('http://localhost:5176/#/tasks');
  await page.waitForSelector('.bottom-nav', { timeout: 15000 });

  // The risky part of this phase: <Routes> became a pathless layout route with <Outlet/> inside
  // it. If that were written as a per-route wrapper instead, the whole gate stack — AppProvider
  // included — would remount on every navigation. DOM node identity is the exact observable:
  // React only creates a new node for .bottom-nav if the layout itself unmounted.
  await page.evaluate(() => {
    window.__nav = document.querySelector('.bottom-nav');
  });
  await page.goto('http://localhost:5176/#/orders');
  await page.waitForSelector('.screen-title');
  await page.goto('http://localhost:5176/#/recipes');
  await page.waitForSelector('.screen-title');
  const navSurvived = await page.evaluate(
    () => window.__nav === document.querySelector('.bottom-nav') && window.__nav.isConnected,
  );
  check('the nav is the same DOM node after two navigations — the layout never remounted', navSurvived);

  await page.goto('http://localhost:5176/#/settings');
  await page.waitForSelector('.screen-title');
  const settingsText = await page.textContent('body');
  check('Settings shows the privacy section in local mode', settingsText.includes('פרטיות וחשבון'));
  check(
    'but offers no account deletion in local mode — there is no account',
    !settingsText.includes('מחיקת החשבון'),
  );
  check('and no join-code rotation either', !settingsText.includes('החלף קוד'));

  // Import: the file input is hidden behind a button, so drive it directly.
  async function importFile(name, contents) {
    await page.setInputFiles('input[type="file"]', {
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(contents, 'utf8'),
    });
    await page.waitForTimeout(400);
  }

  // The bug this phase exists to kill: two fields, a plausible version, and the old code
  // imported it and wiped the kitchen.
  await importFile('evil.json', '{"schemaVersion":5}');
  check(
    'a two-field file is refused rather than imported',
    (await page.locator('[role="dialog"]').count()) === 0,
    await page.textContent('body').then((t) => (t.includes('הגיבוי חסר או פגום') ? 'shows the Hebrew reason' : 'NO REASON SHOWN')),
  );

  await importFile('newer.json', '{"schemaVersion":99,"ingredients":[]}');
  const newerText = await page.textContent('body');
  check('a backup from a newer build is refused by version, not by shape', newerText.includes('גרסה חדשה יותר'));

  // A real export of the current state must still import — and must now ask first. Dispatch one
  // real action first: local mode writes `kitchen-app-state` through the local adapter when an
  // op is appended, so on a fresh browser profile there is nothing there yet to export.
  await page.fill('input[placeholder="שם טבח חדש"]', 'בדיקה');
  await page.getByRole('button', { name: 'הוסף' }).click();
  await page.waitForTimeout(400);
  const exported = await page.evaluate(() => localStorage.getItem('kitchen-app-state'));
  check('a dispatch in local mode persists to kitchen-app-state', typeof exported === 'string');
  await importFile('good.json', exported);
  const dialog = page.locator('[role="dialog"]');
  check('a valid backup opens a confirmation instead of applying silently', (await dialog.count()) === 1);
  const dialogText = await dialog.textContent();
  check('the confirmation says it cannot be undone', dialogText.includes('לא ניתן לבטל'));
  check('and counts what is in the file', /\d+ מצרכים/.test(dialogText));

  // Cancelling must change nothing.
  const before = await page.evaluate(() => localStorage.getItem('kitchen-app-state'));
  await page.getByRole('button', { name: 'ביטול' }).click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => localStorage.getItem('kitchen-app-state'));
  check('cancelling the confirmation applies nothing', before === after);
  check('and closes the dialog', (await page.locator('[role="dialog"]').count()) === 0);

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5176/#/legal/terms');
  await page.waitForSelector('.screen-title');
  check('legal routes work in local mode too', (await page.textContent('.screen-title')) === 'תנאי שימוש');
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
stopServers();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exit(1);
}
