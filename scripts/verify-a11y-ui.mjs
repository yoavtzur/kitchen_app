/**
 * Manual browser check for the accessibility and layout work in the pre-launch audit's phase 5.
 * Not part of the build or `npm test` — this codebase tests pure functions in node on purpose
 * (see CLAUDE.md), and everything below is exactly the class of thing that constraint leaves
 * unverifiable: a focus ring, a scroll lock, a trapped Tab, a toast that has to land on screen
 * rather than off the bottom of a long document.
 *
 *   npm install --no-save playwright      # not a dependency; the container already has Chromium
 *   npm run dev                           # in another shell — this drives the dev server
 *   node scripts/verify-a11y-ui.mjs
 *
 * Runs in local mode. The auth screens need Supabase configured, so they have their own script
 * (verify-auth-forms.mjs). Screenshots land in OUT below; point it anywhere you like.
 */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5173/';
const OUT = process.env.SHOT_DIR ?? mkdtempSync(join(tmpdir(), 'kitchen-shots-'));
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// ---------------------------------------------------------------- phone, local mode
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await phone.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE);
await page.waitForSelector('.app-main', { timeout: 20000 });
await page.waitForTimeout(1200);
check('app boots in local mode', await page.locator('.bottom-nav').isVisible());
check('no console errors on boot', errors.length === 0, errors.join(' | '));

// --- content width at phone size
const widthAt = async (p) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--content-max').trim());
check('--content-max is 720px at 390w', (await widthAt(page)) === '720px', await widthAt(page));

// --- focus ring exists on a real control
await page.keyboard.press('Tab');
const ring = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  return { tag: el.tagName, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, outlineColor: s.outlineColor };
});
check('keyboard focus draws a visible ring', !!ring && ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0, JSON.stringify(ring));

// --- the phase-4 completion checkbox is focusable and visible (regression guard)
await page.goto(BASE + '#/tasks');
await page.waitForTimeout(800);
const cb = page.locator('[role="checkbox"]').first();
if (await cb.count()) {
  const box = await cb.evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: s.display, w: r.width, h: r.height };
  });
  check('completion checkbox is on screen (not display:none)', box.display !== 'none' && box.w > 0 && box.h > 0, JSON.stringify(box));
  await cb.focus();
  const cbRing = await cb.evaluate((el) => getComputedStyle(el).outlineStyle);
  check('completion checkbox shows a focus ring', cbRing !== 'none', cbRing);
} else {
  check('completion checkbox present', false, 'no [role=checkbox] found on /tasks');
}

// ---------------------------------------------------------------- BottomSheet as a dialog
// StockCount's ingredient sheet: opened by tapping an ingredient name.
await page.goto(BASE + '#/count');
await page.waitForTimeout(900);
const opener = page.locator('.count-name-btn').first();
await opener.click();
await page.waitForSelector('.sheet', { timeout: 5000 });

const dlg = await page.locator('.sheet').first().evaluate((el) => ({
  role: el.getAttribute('role'),
  modal: el.getAttribute('aria-modal'),
  labelledby: el.getAttribute('aria-labelledby'),
  labelText: el.getAttribute('aria-labelledby')
    ? document.getElementById(el.getAttribute('aria-labelledby'))?.textContent
    : null,
}));
check('sheet has role=dialog', dlg.role === 'dialog', JSON.stringify(dlg));
check('sheet has aria-modal', dlg.modal === 'true');
check('sheet aria-labelledby resolves to its title', !!dlg.labelText, String(dlg.labelText));

const lockedOverflow = await page.evaluate(() => document.body.style.overflow);
check('page behind the sheet is scroll-locked', lockedOverflow === 'hidden', lockedOverflow);

const focusInSheet = await page.evaluate(() => !!document.querySelector('.sheet')?.contains(document.activeElement));
check('focus moves into the sheet on open', focusInSheet);

// Tab wraps rather than escaping to the page behind.
for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
const stillIn = await page.evaluate(() => !!document.querySelector('.sheet')?.contains(document.activeElement));
check('Tab stays trapped inside the sheet (40 presses)', stillIn);
for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab');
const stillIn2 = await page.evaluate(() => !!document.querySelector('.sheet')?.contains(document.activeElement));
check('Shift+Tab stays trapped too', stillIn2);

// Escape closes, and focus returns to the opener.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape closes the sheet', (await page.locator('.sheet').count()) === 0);
check('scroll lock released on close', (await page.evaluate(() => document.body.style.overflow)) !== 'hidden');
const restored = await page.evaluate(() => document.activeElement?.classList.contains('count-name-btn'));
check('focus returns to the control that opened the sheet', restored === true);

// ---------------------------------------------------------------- nested sheets: one Escape, one sheet
await opener.click();
await page.waitForSelector('.sheet');
// The ingredient sheet holds NumberEditor values, each of which opens a second sheet.
const inner = page.locator('.sheet .number-editor-value').first();
if (await inner.count()) {
  await inner.click();
  await page.waitForTimeout(400);
  const n = await page.locator('.sheet').count();
  check('a nested sheet opens over its parent', n === 2, `${n} sheets`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const after = await page.locator('.sheet').count();
  check('one Escape closes only the innermost sheet', after === 1, `${after} sheets left`);
  const stillLocked = await page.evaluate(() => document.body.style.overflow);
  check('page stays locked while the parent sheet is open', stillLocked === 'hidden', stillLocked);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('second Escape closes the parent', (await page.locator('.sheet').count()) === 0);
  check('lock finally released', (await page.evaluate(() => document.body.style.overflow)) !== 'hidden');
} else {
  check('nested sheet reachable', false, 'no .number-editor-value inside the sheet');
}

// ---------------------------------------------------------------- Toast on a real save
await page.goto(BASE + '#/count');
await page.waitForTimeout(900);
const qtyCell = page.locator('.count-input').first();
if (await qtyCell.count()) {
  // The count cell is a NumberEditor: tapping it opens the keypad sheet, and the value is
  // committed with אישור. Driving it this way also exercises a sheet opened from a list row.
  await qtyCell.click();
  await page.waitForSelector('.sheet .keypad-grid', { timeout: 5000 });
  await page.locator('.sheet .keypad-key', { hasText: '7' }).first().click();
  await page.locator('.sheet button', { hasText: 'אישור' }).first().click();
  await page.waitForTimeout(400);
  const saveBtn = page.locator('.count-save-bar > button');
  if (await saveBtn.count()) {
    // Scroll the save bar into play and confirm the toast lands above it, not under it.
    await saveBtn.click();
    await page.waitForTimeout(400);
    const toast = page.locator('.toast');
    const shown = await toast.count();
    check('saving a count shows a toast', shown === 1, `${shown} toasts`);
    if (shown) {
      const geo = await toast.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, vh: innerHeight, navTop: nav.top, role: el.getAttribute('role') };
      });
      check('toast is inside the viewport', geo.bottom > 0 && geo.bottom <= geo.vh, JSON.stringify(geo));
      check('toast sits above the bottom nav', geo.bottom <= geo.navTop + 1, JSON.stringify(geo));
      check('toast is a live region', geo.role === 'status', geo.role);
    }
    await page.waitForTimeout(2800);
    check('toast removes itself', (await page.locator('.toast').count()) === 0);
  } else {
    check('save bar reachable after editing a count', false);
  }
} else {
  check('a count input was found', false);
}

await page.screenshot({ path: `${OUT}/phone-tasks.png`, fullPage: false });

// ---------------------------------------------------------------- tablet breakpoints
for (const [w, h, expectMax, expectCols, label] of [
  [768, 1024, '900px', 3, 'tablet-768'],
  [1280, 900, '1040px', 4, 'desktop-1280'],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '#/tasks');
  await p2.waitForSelector('.app-main', { timeout: 20000 });
  await p2.waitForTimeout(900);
  const max = await p2.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--content-max').trim());
  check(`--content-max is ${expectMax} at ${w}w`, max === expectMax, max);
  const grid = p2.locator('.tasks-grid').first();
  if (await grid.count()) {
    const cols = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    check(`.tasks-grid has ${expectCols} columns at ${w}w`, cols === expectCols, `${cols} columns`);
    // The 2-column trailing-card stretch must be off above 768.
    const stretched = await grid.evaluate((el) => {
      const kids = [...el.children];
      if (kids.length === 0 || kids.length % 2 === 0) return 'n/a';
      return getComputedStyle(kids[kids.length - 1]).gridColumn;
    });
    check(`trailing-card full-row stretch is off at ${w}w`, stretched === 'n/a' || !stretched.includes('1 / -1') , String(stretched));
  }
  const navW = await p2.locator('.bottom-nav').evaluate((el) => el.getBoundingClientRect().width);
  const mainW = await p2.locator('.app-main').evaluate((el) => el.getBoundingClientRect().width);
  check(`nav and content agree on width at ${w}w`, Math.abs(navW - mainW) < 2, `nav ${navW} vs main ${mainW}`);
  await p2.screenshot({ path: `${OUT}/${label}.png` });
  await ctx.close();
}

// ---------------------------------------------------------------- reduced motion
const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const p3 = await rm.newPage();
await p3.goto(BASE + '#/tasks');
await p3.waitForSelector('.app-main', { timeout: 20000 });
await p3.waitForTimeout(900);
const anim = await p3.evaluate(() => {
  const out = [];
  for (const sel of ['.priority-dot.red', '.home-blob-a', '.home-blob-b', '.home-mascot', '.skeleton-block']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const s = getComputedStyle(el);
    out.push({ sel, name: s.animationName, duration: s.animationDuration });
  }
  return out;
});
check(
  'decorative animations are off under prefers-reduced-motion',
  anim.every((a) => a.name === 'none' || parseFloat(a.duration) <= 0.001),
  JSON.stringify(anim),
);
await rm.close();
await phone.close();

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\nscreenshots: ${OUT}`);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  process.exit(1);
}
