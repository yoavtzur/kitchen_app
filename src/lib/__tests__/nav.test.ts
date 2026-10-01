import { describe, expect, it } from 'vitest';
import { isTabActive, navTabsFor } from '../nav';

describe('navTabsFor', () => {
  it('gives a chef the five management tabs, tasks first', () => {
    expect(navTabsFor('chef').map((t) => t.to)).toEqual(['/tasks', '/count', '/orders', '/consumption', '/menu']);
  });

  it('gives a cook tasks, recipes, stock and a menu — and no procurement screens', () => {
    const tos = navTabsFor('cook').map((t) => t.to);
    expect(tos).toEqual(['/tasks', '/recipes', '/count', '/menu']);
    expect(tos).not.toContain('/orders');
    expect(tos).not.toContain('/consumption');
  });

  it('keeps a menu tab for a cook, because sign-out and account deletion live behind it', () => {
    expect(navTabsFor('cook').some((t) => t.to === '/menu')).toBe(true);
  });

  it('carries the open-task badge on the tasks tab only', () => {
    for (const role of ['chef', 'cook'] as const) {
      expect(navTabsFor(role).filter((t) => t.badge).map((t) => t.to)).toEqual(['/tasks']);
    }
  });
});

describe('isTabActive', () => {
  const chef = navTabsFor('chef');
  const tab = (to: string) => chef.find((t) => t.to === to)!;

  it('matches the tab path exactly and as a prefix', () => {
    expect(isTabActive(tab('/orders'), '/orders')).toBe(true);
    expect(isTabActive(tab('/orders'), '/orders/anything')).toBe(true);
  });

  it('does not match a path that merely shares leading characters', () => {
    expect(isTabActive(tab('/orders'), '/ordersx')).toBe(false);
  });

  it('keeps the menu tab lit on the screens it opens', () => {
    for (const p of ['/menu', '/recipes', '/settings', '/stations', '/team', '/profile']) {
      expect(isTabActive(tab('/menu'), p)).toBe(true);
    }
    expect(isTabActive(tab('/menu'), '/tasks')).toBe(false);
  });

  it('lights exactly one tab for any chef path', () => {
    for (const p of ['/tasks', '/count', '/orders', '/consumption', '/menu', '/recipes', '/stations', '/team', '/profile']) {
      expect(chef.filter((t) => isTabActive(t, p))).toHaveLength(1);
    }
  });
});
