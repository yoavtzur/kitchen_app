import { describe, expect, it } from 'vitest';
import { handleScanRequest, validateScanBody, type ScanEnv } from '../_gemini.js';
import { bearerToken, isAllowedOrigin, parseAllowlist, scanAuthMode } from '../_auth.js';

// These guards are the only thing standing between a public URL and a metered Gemini account,
// so they are tested as pure functions here rather than only exercised live.

/** A base64 payload long enough to clear MIN_BASE64_CHARS. */
const REAL_IMAGE = 'A'.repeat(2000);

/** Points at a port nothing listens on, so any attempt to reach Supabase fails immediately.
 * That is the point: a test that gets a 400 with this configured has *proved* no network call
 * was made, without mocking anything. */
const UNREACHABLE: ScanEnv['supabase'] = { url: 'http://127.0.0.1:1', anonKey: 'anon' };

function env(overrides: Partial<ScanEnv> = {}): ScanEnv {
  return { geminiApiKey: 'test-key', supabase: UNREACHABLE, allowedOrigins: [], ...overrides };
}

function post(body: unknown, extra: Partial<Parameters<typeof handleScanRequest>[0]> = {}) {
  return {
    method: 'POST',
    origin: undefined,
    host: 'kitchen.example',
    authorization: undefined,
    contentLength: undefined,
    body,
    ...extra,
  };
}

describe('bearerToken', () => {
  it('reads a well-formed header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc')).toBe('abc');
  });

  it('treats anything else as no token, never as a token to try', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('abc.def.ghi')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
  });
});

describe('isAllowedOrigin', () => {
  it('allows the page that called us, which covers production, previews and localhost', () => {
    expect(isAllowedOrigin('https://kitchen.example', 'kitchen.example')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', 'localhost:5173')).toBe(true);
  });

  it('rejects another site', () => {
    expect(isAllowedOrigin('https://evil.example', 'kitchen.example')).toBe(false);
  });

  it('honours an explicit allowlist, with or without a scheme', () => {
    expect(isAllowedOrigin('https://partner.example', 'kitchen.example', ['https://partner.example'])).toBe(true);
    expect(isAllowedOrigin('https://partner.example', 'kitchen.example', ['partner.example'])).toBe(true);
    expect(isAllowedOrigin('https://partner.example', 'kitchen.example', ['other.example'])).toBe(false);
  });

  it('allows a request with no Origin at all', () => {
    // Not a browser, so there is no cross-site attack to stop here — and the token plus quota
    // bound it anyway. Documented rather than accidental: see the comment on isAllowedOrigin.
    expect(isAllowedOrigin(undefined, 'kitchen.example')).toBe(true);
  });

  it('rejects a syntactically impossible Origin', () => {
    expect(isAllowedOrigin('not a url', 'kitchen.example')).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('splits, trims and drops blanks', () => {
    expect(parseAllowlist(' a.example , b.example ,, ')).toEqual(['a.example', 'b.example']);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});

describe('scanAuthMode', () => {
  it('uses Supabase when it is configured', () => {
    expect(scanAuthMode({ url: 'https://x.supabase.co', anonKey: 'k' })).toBe('supabase');
  });

  it('refuses by default when Supabase is missing, rather than falling open', () => {
    // The footgun this prevents: "forgot to set SUPABASE_URL in Vercel" must not silently mean
    // "the Gemini budget is public".
    expect(scanAuthMode({})).toBe('closed');
    expect(scanAuthMode({ url: 'https://x.supabase.co' })).toBe('closed');
  });

  it('opens only on an explicit opt-out', () => {
    expect(scanAuthMode({ allowAnonymous: true })).toBe('open');
  });
});

describe('validateScanBody', () => {
  it('accepts a plausible image', () => {
    expect(validateScanBody({ imageBase64: REAL_IMAGE, mimeType: 'image/jpeg' })).toEqual({ error: null });
  });

  it('accepts HEIC and HEIF', () => {
    // imageDownscale.ts falls back to the file's own type when canvas decoding fails, which on
    // older iOS is image/heic — rejecting it would break exactly the phones that need the
    // fallback most.
    expect(validateScanBody({ imageBase64: REAL_IMAGE, mimeType: 'image/heic' }).error).toBeNull();
    expect(validateScanBody({ imageBase64: REAL_IMAGE, mimeType: 'IMAGE/HEIF' }).error).toBeNull();
  });

  it('rejects a mime type Gemini would be asked to read anyway', () => {
    expect(validateScanBody({ imageBase64: REAL_IMAGE, mimeType: 'application/pdf' })).toEqual({
      error: 'bad-mime',
      status: 400,
    });
  });

  it('rejects a payload too short to be a photograph', () => {
    // Four characters used to buy a full Gemini call.
    expect(validateScanBody({ imageBase64: 'AAAA', mimeType: 'image/jpeg' })).toEqual({
      error: 'bad-request',
      status: 400,
    });
  });

  it('rejects something that is not base64 at all', () => {
    expect(validateScanBody({ imageBase64: `${'x'.repeat(2000)}<script>`, mimeType: 'image/jpeg' })).toEqual({
      error: 'bad-request',
      status: 400,
    });
  });

  it('rejects an oversized payload and a missing one', () => {
    expect(validateScanBody({ imageBase64: 'A'.repeat(3_000_001), mimeType: 'image/jpeg' })).toEqual({
      error: 'too-large',
      status: 413,
    });
    expect(validateScanBody({}).error).toBe('bad-request');
    expect(validateScanBody(null).error).toBe('bad-request');
  });
});

describe('handleScanRequest pipeline', () => {
  it('refuses a foreign origin before anything else', async () => {
    const reply = await handleScanRequest(post({ imageBase64: REAL_IMAGE }, { origin: 'https://evil.example' }), env());
    expect(reply.status).toBe(403);
  });

  it('answers GET with whether a key is configured', async () => {
    const reply = await handleScanRequest(post(undefined, { method: 'GET' }), env());
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ configured: true });
    expect(reply.headers['Cache-Control']).toBe('no-store');
  });

  it('rejects other methods', async () => {
    expect((await handleScanRequest(post(undefined, { method: 'DELETE' }), env())).status).toBe(405);
  });

  it('rejects an oversized body from Content-Length alone', async () => {
    const reply = await handleScanRequest(post(undefined, { contentLength: '9000000' }), env());
    expect(reply.status).toBe(413);
  });

  it('validates the payload BEFORE spending a quota unit', async () => {
    // The ordering proof: Supabase is configured but unreachable here, so if the quota check ran
    // first this would be a 503. Getting a 400 means no unit was consumed and no round trip was
    // made — which matters because there is deliberately no refund path.
    const reply = await handleScanRequest(post({ imageBase64: REAL_IMAGE, mimeType: 'application/pdf' }), env());
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'bad-mime' });
  });

  it('demands a token once the payload is valid', async () => {
    const reply = await handleScanRequest(
      post({ imageBase64: REAL_IMAGE, mimeType: 'image/jpeg' }),
      env({ supabase: { url: 'https://x.supabase.co', anonKey: 'anon' } }),
    );
    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({ error: 'unauthorized' });
  });

  it('fails closed when Supabase is not configured', async () => {
    const reply = await handleScanRequest(
      post({ imageBase64: REAL_IMAGE, mimeType: 'image/jpeg' }, { authorization: 'Bearer t' }),
      env({ supabase: {} }),
    );
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: 'unavailable' });
  });

  it('fails closed when Supabase is unreachable, rather than spending the budget blind', async () => {
    const reply = await handleScanRequest(
      post({ imageBase64: REAL_IMAGE, mimeType: 'image/jpeg' }, { authorization: 'Bearer t' }),
      env(),
    );
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: 'unavailable' });
  });

  it('parses a raw string body the same way as a pre-parsed one', async () => {
    const reply = await handleScanRequest(
      post(JSON.stringify({ imageBase64: REAL_IMAGE, mimeType: 'application/pdf' })),
      env(),
    );
    expect(reply.body).toEqual({ error: 'bad-mime' });
    expect((await handleScanRequest(post('not json'), env())).status).toBe(400);
  });
});
