/**
 * Manual browser check for the role-based nav, the unified orders screen, station management and
 * the stock tabs. Not part of the build or `npm test` — see CLAUDE.md on why this codebase tests
 * pure functions in node and checks the rest live. Everything here is layout or behaviour a node
 * test cannot see: how many rows fit on a phone, whether a sticky tab row actually sticks, whether
 * a button is enabled the moment a screen loads.
 *
 *   npm install --no-save playwright
 *   npm run dev                      # in another shell
 *   node scripts/verify-nav-orders.mjs
 *
 * Local mode only (no Supabase env): there, everyone is a chef, so the *cook's* nav is covered by
 * `nav.test.ts` and has to be checked by hand against a real cook account in a preview.
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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const go = async (hash) => {
  await page.goto(`${BASE}#${hash}`);
  await page.waitForSelector('.app-main');
};
// The local store writes its key lazily, on the first change.
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('kitchen-app-state') ?? '{"orderLines":[],"stations":[]}'));

await go('/');
await page.waitForURL(/#\/tasks/);

// ---- nav
const labels = await page.$$eval('.bottom-nav a', (as) => as.map((a) => a.querySelector(':scope > span:last-child')?.textContent?.trim()));
check('chef nav is tasks / stock / orders / consumption / menu', JSON.stringify(labels) === JSON.stringify(['משימות', 'מלאי', 'הזמנות', 'צריכה', 'תפריט']), labels.join(' | '));

await go('/more');
check('/more redirects to /menu', page.url().endsWith('#/menu'));
await go('/morning');
check('/morning redirects to /orders', page.url().endsWith('#/orders'));
await go('/menu');
check('menu tab is lit on /menu', (await page.$$eval('.bottom-nav a.active', (a) => a.map((x) => x.textContent?.trim()))).join() === 'תפריט');
const menuRows = await page.$$eval('.menu-row-label', (e) => e.map((x) => x.textContent?.trim()));
check('chef menu lists recipes, stations and settings', ['מתכונים', 'ניהול פסים', 'צוות והגדרות'].every((l) => menuRows.includes(l)), menuRows.join(' | '));
await page.screenshot({ path: join(OUT, 'menu.png') });

// ---- morning order
await go('/orders');
await page.waitForSelector('.morning-row');
const seg = await page.$$eval('.segmented button', (b) => b.map((x) => x.textContent?.trim()));
check('orders has the three segments', JSON.stringify(seg) === JSON.stringify(['בוקר', 'לפי ספק', 'היסטוריה']), seg.join(' | '));

const visible = await page.evaluate(() => {
  const bar = document.querySelector('.count-save-bar button')?.getBoundingClientRect();
  const limit = bar ? bar.top : window.innerHeight;
  return [...document.querySelectorAll('.morning-row')].filter((r) => r.getBoundingClientRect().bottom <= limit).length;
});
const total = await page.$$eval('.morning-row', (r) => r.length);
check('at least 7 ingredient rows are visible at once on a phone', visible >= 7 || visible === total, `${visible} visible of ${total}`);
const rowH = await page.$eval('.morning-row', (r) => Math.round(r.getBoundingClientRect().height));
check('a row is about 56px tall', rowH >= 52 && rowH <= 64, `${rowH}px`);
check('the old "suggested order" label is gone', (await page.locator('text=להזמנה מוצע').count()) === 0);
check('the unit moved into the item name line, not a label of its own', (await page.locator('.morning-row-sub').first().textContent())?.includes('·') ?? false);

const approve = page.locator('.count-save-bar button');
check('approve is enabled the moment the screen loads (zero-touch)', await approve.isEnabled(), await approve.textContent());
await page.screenshot({ path: join(OUT, 'morning.png') });

const before = (await state()).orderLines.length;
await approve.click();
const after = (await state()).orderLines.length;
check('approving with no edits creates the order', after > before, `${before} -> ${after} order lines`);

// ---- fill to par + undo
const fill = page.getByRole('button', { name: 'מלא לפי המינימום' });
await go('/orders');
await page.waitForSelector('.morning-row');
// lines submitted above are `ordered`, so there is nothing to reset yet
check('fill-to-par is disabled while there is nothing hand-typed to reset', await fill.isDisabled());
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('kitchen-app-state'));
  s.orderLines = [];
  localStorage.setItem('kitchen-app-state', JSON.stringify(s));
});
await page.reload();
await page.waitForSelector('.morning-row');
const firstOrder = page.locator('.morning-input.order').first();
const suggested = await firstOrder.inputValue();
await firstOrder.fill('7.5');
await firstOrder.blur();
check('typing an order quantity commits on blur', (await state()).orderLines.some((l) => l.qtyOverride === 7.5));
check('fill-to-par is enabled once something was typed', await fill.isEnabled());
await fill.click();
await page.getByRole('button', { name: 'חזור להצעה האוטומטית' }).click();
check('fill-to-par restores the suggestion', (await firstOrder.inputValue()) === suggested, `${suggested}`);
check('an undo toast appears', await page.locator('.toast-action').isVisible());
await page.locator('.toast-action').click();
check('undo brings the typed value back', (await firstOrder.inputValue()) === '7.5');

// ---- info sheet
await page.locator('.info-btn').first().click();
check('the (i) opens a sheet with forecast and minimum', (await page.locator('[role=dialog]').count()) === 1 && (await page.locator('[role=dialog] >> text=מלאי מינימום').count()) === 1);
await page.keyboard.press('Escape');

// ---- stock count: tabs + views
await go('/count');
await page.waitForSelector('.sticky-tabs');
const tabs = await page.$$eval('.sticky-tabs .tab', (t) => t.map((x) => x.textContent?.trim()));
check('stock tabs lead with הכל and have no duplicates', tabs[0] === 'הכל' && new Set(tabs).size === tabs.length, tabs.join(' | '));
if (tabs.length > 1) {
  const rowsAll = await page.$$eval('.data-table tbody tr', (r) => r.length);
  await page.locator('.sticky-tabs .tab', { hasText: tabs[1] }).click();
  const rowsOne = await page.$$eval('.data-table tbody tr', (r) => r.length);
  check('a category tab filters instantly, client-side', rowsOne > 0 && rowsOne <= rowsAll, `${rowsAll} -> ${rowsOne}`);
}
await page.evaluate(() => window.scrollTo(0, 400));
const stickyTop = await page.$eval('.sticky-tabs', (e) => Math.round(e.getBoundingClientRect().top));
check('the tab row stays pinned while the list scrolls', stickyTop <= 2, `top=${stickyTop}`);
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole('tab', { name: 'מוצרים' }).click();
const stationTabs = await page.$$eval('.sticky-tabs .tab', (t) => t.map((x) => x.textContent?.trim()));
check('products are filtered by station tabs', stationTabs[0] === 'הכל', stationTabs.join(' | '));
await page.screenshot({ path: join(OUT, 'count.png') });

// ---- stations
await go('/stations');
await page.waitForSelector('#new-station');
await page.fill('#new-station', 'גריל');
await page.getByRole('button', { name: 'הוסף פס' }).click();
check('a station can be added', (await state()).stations.some((s) => s.name === 'גריל'));
check('no delete buttons outside edit mode', (await page.locator('[aria-label^="מחיקת הפס"]').count()) === 0);
await page.getByRole('button', { name: 'עריכה' }).click();
await page.locator('[aria-label="מחיקת הפס: גריל"]').click();
check('delete asks where the work goes, defaulting to כללי', (await page.locator('#move-station-to').inputValue()) === 'general');
await page.screenshot({ path: join(OUT, 'stations-delete.png') });
await page.getByRole('button', { name: 'מחק פס' }).click();
check('confirming deletes the station', !(await state()).stations.some((s) => s.name === 'גריל'));

// ---- a cook-only URL guard needs a real cook; at least confirm chef can open chef routes
await go('/consumption');
await page.waitForSelector('.screen-title');
check('chef can open /consumption', ((await page.locator('h1.screen-title').first().textContent()) ?? '').includes('צריכה'));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' || '));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
