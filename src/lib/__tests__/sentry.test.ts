import { describe, expect, it } from 'vitest';
import { opBreadcrumb, sanitizeBreadcrumb, sanitizeEvent, scrubText } from '../sentry';
import type { ErrorEvent } from '@sentry/react';

// The scrubber is only as good as this table. Everything here is either a real leak path
// traced through the code (the Postgres detail one especially — see the comment on
// PG_KEY_DETAIL) or a shape that would be a leak if it ever appeared.

describe('scrubText', () => {
  it('collapses the value Postgres quotes into a constraint violation', () => {
    const real =
      'duplicate key value violates unique constraint "ingredients_name_key" DETAIL: Key (name)=(פטרוזיליה) already exists. (23505)';
    const scrubbed = scrubText(real);
    expect(scrubbed).toContain('Key (…)=(…)');
    expect(scrubbed).toContain('23505');
    expect(scrubbed).not.toContain('פטרוזיליה');
  });

  it('removes Hebrew of any length, including a two-letter name', () => {
    expect(scrubText('failed to save רוטב עגבניות חריף')).toBe('failed to save [he]');
    expect(scrubText('item בר missing')).toBe('item [he] missing');
    // A multi-word Hebrew phrase collapses to one marker, not one per word.
    expect(scrubText('שם המוצר שגוי').match(/\[he\]/g)).toHaveLength(1);
  });

  it('leaves an ordinary English runtime error untouched', () => {
    const message = "Cannot read properties of undefined (reading 'items')";
    expect(scrubText(message)).toBe(message);
  });

  it('masks emails and UUIDs', () => {
    expect(scrubText('user cook@example.com not found')).toBe('user [email] not found');
    expect(scrubText('restaurant 6f1e4d0c-9a2b-4c3d-8e5f-0a1b2c3d4e5f missing')).toBe(
      'restaurant [uuid] missing',
    );
  });

  it('is safe on text with nothing to scrub', () => {
    expect(scrubText('')).toBe('');
    expect(scrubText('NetworkError when attempting to fetch resource.')).toBe(
      'NetworkError when attempting to fetch resource.',
    );
  });
});

describe('opBreadcrumb', () => {
  it('carries the action type and nothing else', () => {
    const crumb = opBreadcrumb('SET_PRODUCT_QTY');
    // The point of the assertion: no payload key can ever be added here without this failing.
    expect(Object.keys(crumb).sort()).toEqual(['category', 'level', 'message']);
    expect(crumb.message).toBe('SET_PRODUCT_QTY');
    expect(crumb.category).toBe('op');
  });
});

describe('sanitizeBreadcrumb', () => {
  it('drops console breadcrumbs entirely', () => {
    expect(sanitizeBreadcrumb({ category: 'console', message: 'dispatch {"name":"פטרוזיליה"}' })).toBeNull();
  });

  it('drops input breadcrumbs', () => {
    expect(sanitizeBreadcrumb({ category: 'ui.input', message: 'input[name=qty]' })).toBeNull();
  });

  it('strips the query string off a PostgREST call, keeping method and status', () => {
    const crumb = sanitizeBreadcrumb({
      category: 'fetch',
      data: {
        method: 'GET',
        status_code: 200,
        url: 'https://abc.supabase.co/rest/v1/ingredients?name=eq.%D7%A4%D7%98%D7%A8%D7%95%D7%96%D7%99%D7%9C%D7%99%D7%94',
      },
    });
    expect(crumb?.data?.url).toBe('https://abc.supabase.co/rest/v1/ingredients');
    expect(crumb?.data?.method).toBe('GET');
    expect(crumb?.data?.status_code).toBe(200);
  });

  it('reports a relative url as a path, never under a fabricated origin', () => {
    const crumb = sanitizeBreadcrumb({ category: 'xhr', data: { url: '/api/scan-recipe?x=1' } });
    expect(crumb?.data?.url).toBe('/api/scan-recipe');
  });

  it('scrubs the message of any other breadcrumb', () => {
    const crumb = sanitizeBreadcrumb({ category: 'navigation', message: 'opened מתכון פיצה' });
    expect(crumb?.message).toBe('opened [he]');
  });

  it('keeps the op breadcrumb it was given', () => {
    const crumb = sanitizeBreadcrumb(opBreadcrumb('CONFIRM_AUTO_TASK_COMPLETION'));
    expect(crumb?.message).toBe('CONFIRM_AUTO_TASK_COMPLETION');
  });
});

describe('sanitizeEvent', () => {
  function baseEvent(): ErrorEvent {
    return {
      type: undefined,
      message: 'failed saving מלפפון חמוץ',
      extra: { state: { ingredients: [{ name: 'בצל' }] } },
      contexts: { state: { state: { value: 'everything', type: 'redux' } }, device: { name: 'iPad' } },
      user: { id: 'u1', email: 'cook@example.com' },
      exception: {
        values: [{ type: 'Error', value: 'Key (name)=(בצל) already exists' }],
      },
      breadcrumbs: [{ category: 'navigation', message: 'עברתי למסך מתכונים' }],
    } as unknown as ErrorEvent;
  }

  it('deletes the containers that could hold app state', () => {
    const event = sanitizeEvent(baseEvent());
    expect(event.extra).toBeUndefined();
    expect(event.contexts?.state).toBeUndefined();
    // An allowlist, not a scrub: unrelated contexts survive.
    expect(event.contexts?.device).toEqual({ name: 'iPad' });
  });

  it('deletes user, which is where an email would ride along', () => {
    expect(sanitizeEvent(baseEvent()).user).toBeUndefined();
  });

  it('scrubs the message, every exception value, and every breadcrumb', () => {
    const event = sanitizeEvent(baseEvent());
    expect(event.message).toBe('failed saving [he]');
    expect(event.exception?.values?.[0].value).toBe('Key (…)=(…) already exists');
    expect(event.breadcrumbs?.[0].message).toBe('[he]');
  });

  it('survives an event with none of those fields', () => {
    expect(() => sanitizeEvent({} as ErrorEvent)).not.toThrow();
  });
});
