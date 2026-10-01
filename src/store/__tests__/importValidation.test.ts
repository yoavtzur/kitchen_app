import { describe, expect, it } from 'vitest';
import { parseImportedState } from '../storage';
import { createSeedState, SCHEMA_VERSION } from '../../data/seed';

/**
 * The importer is the most destructive path in the app: in remote mode its output goes straight
 * to `reset_snapshot`, which replaces an entire restaurant for every device at once. So these
 * tests are mostly about what it *refuses*.
 */

function backup(overrides: Record<string, unknown> = {}): string {
  const seed = createSeedState();
  return JSON.stringify({ ...seed, ...overrides });
}

function reject(json: string): string {
  const result = parseImportedState(json);
  if (result.ok) throw new Error('expected this backup to be rejected, but it was accepted');
  return result.error;
}

describe('the version gate', () => {
  it('refuses a file whose version this build does not know', () => {
    // The original bug, exactly as it was reachable from the UI: the old importer recognised
    // versions 1-4 and fell through to `return parsed` for everything else, so this two-field
    // object "imported successfully" and wiped a kitchen.
    expect(reject('{"schemaVersion":5}')).toContain('חסר או פגום');
  });

  it('refuses a backup written by a newer version of the app, and says so', () => {
    const error = reject(backup({ schemaVersion: SCHEMA_VERSION + 1 }));
    expect(error).toContain('גרסה חדשה יותר');
    expect(error).toContain(String(SCHEMA_VERSION + 1));
  });

  it.each([
    ['no version at all', '{"ingredients":[]}'],
    ['a version that is not a number', '{"schemaVersion":"5"}'],
    ['a fractional version', '{"schemaVersion":4.5}'],
    ['a zero version', '{"schemaVersion":0}'],
    ['a negative version', '{"schemaVersion":-1}'],
  ])('refuses %s', (_label, json) => {
    expect(reject(json)).toBeTruthy();
  });

  it.each([
    ['not JSON at all', 'not json'],
    ['an empty file', ''],
    ['a JSON array', '[]'],
    ['a JSON string', '"hello"'],
    ['JSON null', 'null'],
  ])('refuses %s', (_label, json) => {
    expect(reject(json)).toBeTruthy();
  });
});

describe('the shape gate', () => {
  it('accepts a real, current backup', () => {
    const result = parseImportedState(backup());
    expect(result.ok).toBe(true);
  });

  it.each([
    ['ingredients', 'מצרכים'],
    ['recipes', 'מתכונים'],
    ['products', 'מוצרים'],
    ['cooks', 'טבחים'],
    ['stations', 'עמדות'],
    ['orderLines', 'שורות הזמנה'],
    ['taskOverrides', 'סימוני משימות'],
  ])('refuses a backup missing %s, naming it in Hebrew', (key, label) => {
    const json = JSON.parse(backup());
    delete json[key];
    expect(reject(JSON.stringify(json))).toContain(label);
  });

  it('refuses a collection that is present but not an array', () => {
    expect(reject(backup({ ingredients: {} }))).toContain('מצרכים');
  });

  it('refuses a row with no id, and says which row', () => {
    const json = JSON.parse(backup());
    delete json.ingredients[2].id;
    const error = reject(JSON.stringify(json));
    expect(error).toContain('מצרכים');
    expect(error).toContain('3');
  });

  it('refuses a row whose id is blank rather than absent', () => {
    const json = JSON.parse(backup());
    json.cooks[0].id = '   ';
    expect(reject(JSON.stringify(json))).toContain('טבחים');
  });

  it('refuses an order line with no date — its key is (ingredientId, date), not an id', () => {
    expect(reject(backup({ orderLines: [{ ingredientId: 'ing-egg', ordered: false }] }))).toContain(
      'שורות הזמנה',
    );
  });

  it('refuses a day plan with no entries array', () => {
    // calc.ts and Consumption both walk `entries` straight off a DayPlan without checking.
    expect(reject(backup({ dayPlans: [{ date: '2026-09-30' }] }))).toContain('תוכנית יומית');
  });

  it('refuses a recipe with no items array', () => {
    const json = JSON.parse(backup());
    delete json.recipes[0].items;
    expect(reject(JSON.stringify(json))).toContain('מרכיבים');
  });

  it('refuses a missing settings object', () => {
    const json = JSON.parse(backup());
    delete json.settings;
    expect(reject(JSON.stringify(json))).toContain('הגדרות');
  });

  it('fills a partial settings object from the defaults rather than refusing it', () => {
    // The one repair this module allows, and only because every setting has a meaningful
    // default — see the module comment. An ingredient has no default, so it is never invented.
    const result = parseImportedState(backup({ settings: { weekStartsOn: 1 } }));
    if (!result.ok) throw new Error(result.error);
    expect(result.state.settings).toEqual({
      ...createSeedState().settings,
      weekStartsOn: 1,
    });
  });
});

describe('the summary shown before the restaurant is replaced', () => {
  it('counts what is actually in the file', () => {
    const seed = createSeedState();
    const result = parseImportedState(backup());
    if (!result.ok) throw new Error(result.error);
    expect(result.summary).toEqual({
      fromVersion: SCHEMA_VERSION,
      ingredients: seed.ingredients.length,
      products: seed.products.length,
      recipes: seed.recipes.length,
      tasks: seed.tasks.length,
      cooks: seed.cooks.length,
    });
  });

  it('reports the version the file declared, not the migrated one', () => {
    // Importing an old backup is legitimate; silently presenting it as current is not.
    const result = parseImportedState(
      JSON.stringify({
        schemaVersion: 4,
        settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
        cooks: [{ id: 'c1', name: 'דני', color: '#000' }],
        ingredients: [],
        products: [],
        recipes: [],
        tasks: [],
        taskOverrides: [],
        specialEvents: [],
        dayPlans: [],
        orderLines: [],
      }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.summary.fromVersion).toBe(4);
    expect(result.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.summary.cooks).toBe(1);
  });

  it('a migration that throws on a file lying about its version is a rejection, not a crash', () => {
    // v3 → v4 maps over `orderLines`; a file claiming v3 without one used to throw out of
    // parseImportedState entirely.
    expect(reject('{"schemaVersion":3,"ingredients":[]}')).toContain('פגום');
  });
});
