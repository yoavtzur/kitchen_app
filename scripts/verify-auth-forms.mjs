/**
 * Manual browser check for the auth forms' password-manager and labelling work (phase 5).
 *
 * The auth screens only render when Supabase is configured, which is what the stub URL below is
 * for: nothing here needs a working backend, because what is under test is the markup — a real
 * <form>, a submit button, a label per input, and the right autocomplete hint per mode. The one
 * check that does exercise behaviour (Enter reaching the submit handler) uses the resulting
 * network failure as its evidence.
 *
 *   npm install --no-save playwright
 *   VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=stub-anon-key \
 *     npx vite --port 5199                # in another shell
 *   node scripts/verify-auth-forms.mjs
 *
 * Set CHROMIUM_PATH if playwright cannot find a browser itself.
 */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5199/';
const OUT = process.env.SHOT_DIR ?? mkdtempSync(join(tmpdir(), 'kitchen-shots-'));
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

async function formShape() {
  return page.evaluate(() => {
    const f = document.querySelector('form');
    if (!f) return null;
    return {
      hasSubmit: !!f.querySelector('button[type="submit"]'),
      // Any non-submit button inside a form must say so, or it submits on click.
      untypedButtons: [...f.querySelectorAll('button')].filter((b) => !b.getAttribute('type')).length,
      inputs: [...f.querySelectorAll('input')].map((i) => ({
        name: i.name,
        type: i.type,
        autocomplete: i.autocomplete,
        labelled: !!(i.id && document.querySelector(`label[for="${i.id}"]`)) || i.hidden,
        hidden: i.hidden,
      })),
    };
  });
}

await page.goto(BASE);
await page.waitForSelector('form', { timeout: 20000 });
await page.waitForTimeout(600);

// ---------------------------------------------------------------- sign in
let f = await formShape();
check('sign-in renders a real form with a submit button', f?.hasSubmit === true, JSON.stringify(f));
check('no untyped buttons inside the sign-in form', f.untypedButtons === 0, `${f.untypedButtons} untyped`);
check('every sign-in input is labelled', f.inputs.every((i) => i.labelled), JSON.stringify(f.inputs));
check(
  'sign-in asks for the stored credential',
  f.inputs.some((i) => i.autocomplete === 'username') && f.inputs.some((i) => i.autocomplete === 'current-password'),
  JSON.stringify(f.inputs.map((i) => i.autocomplete)),
);
await page.screenshot({ path: `${OUT}/auth-signin.png` });

// Enter submits now that there is a form — previously an onKeyDown per input.
await page.locator('form input[type="email"]').fill('nobody@example.com');
await page.locator('form input[type="password"]').fill('short');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
// Against a stub Supabase URL the request cannot succeed — and that is exactly the evidence
// wanted here. An error message can only appear if Enter reached the submit handler, which is
// what previously needed an onKeyDown on every input.
const afterEnter = await page.evaluate(() => {
  const f = document.querySelector('form');
  return [...f.querySelectorAll('p')].map((p) => p.textContent.trim()).filter(Boolean);
});
check('Enter reaches the submit handler', afterEnter.length > 0, JSON.stringify(afterEnter));
// The browser must not have navigated: a form without preventDefault does a GET and reloads.
check('submitting does not reload the page', page.url().startsWith(BASE) && !page.url().includes('?'), page.url());

// ---------------------------------------------------------------- sign up swaps the hint
await page.reload();
await page.waitForSelector('form');
await page.locator('button', { hasText: 'משתמש חדש? הרשמה' }).click();
await page.waitForTimeout(400);
const signupAc = await page.locator('form input[type="password"]').evaluate((i) => i.autocomplete);
check('signup switches the password hint to new-password', signupAc === 'new-password', signupAc);

// ---------------------------------------------------------------- forgot password
await page.reload();
await page.waitForSelector('form');
await page.locator('button', { hasText: 'שכחתי סיסמה' }).click();
await page.waitForTimeout(500);
f = await formShape();
check('forgot-password renders a form with a submit button', f?.hasSubmit === true, JSON.stringify(f));
check('no untyped buttons in the forgot-password form', f.untypedButtons === 0);
check('forgot-password email is labelled and hinted', f.inputs.every((i) => i.labelled && i.autocomplete === 'username'), JSON.stringify(f.inputs));
await page.screenshot({ path: `${OUT}/auth-forgot.png` });

// ---------------------------------------------------------------- focus ring on the auth screens
await page.reload();
await page.waitForSelector('form');
await page.keyboard.press('Tab');
const ring = await page.evaluate(() => {
  const s = getComputedStyle(document.activeElement);
  return { tag: document.activeElement.tagName, style: s.outlineStyle, width: s.outlineWidth };
});
check('auth screen shows a focus ring', ring.style !== 'none' && parseFloat(ring.width) > 0, JSON.stringify(ring));

check('no uncaught page errors', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\nscreenshots: ${OUT}`);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const x of failed) console.log(` - ${x.name}: ${x.detail}`);
  process.exit(1);
}
