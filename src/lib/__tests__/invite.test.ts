import { describe, expect, it } from 'vitest';
import { buildInviteLink, buildWhatsAppUrl, inviteMessage, parseInviteToken } from '../invite';

const TOKEN = '0123456789abcdef0123456789abcdef';

describe('parseInviteToken', () => {
  it('accepts 32 hex characters', () => {
    expect(parseInviteToken(TOKEN)).toBe(TOKEN);
  });

  it('lower-cases and trims, since a chat app or a retype can change both', () => {
    expect(parseInviteToken(`  ${TOKEN.toUpperCase()} `)).toBe(TOKEN);
  });

  it.each([
    ['', 'empty'],
    ['abc', 'too short'],
    [TOKEN + '0', 'too long'],
    ['g'.repeat(32), 'not hex'],
    [`${TOKEN.slice(0, 31)}/`, 'a path character'],
  ])('rejects %s (%s)', (raw) => {
    expect(parseInviteToken(raw)).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(parseInviteToken(null)).toBeNull();
    expect(parseInviteToken(undefined)).toBeNull();
  });
});

describe('buildInviteLink', () => {
  it('puts the token in the hash route, after the app path', () => {
    expect(buildInviteLink('https://app.example', '/', TOKEN)).toBe(`https://app.example/#/join/${TOKEN}`);
    expect(buildInviteLink('https://app.example', '/kitchen/', TOKEN)).toBe(`https://app.example/kitchen/#/join/${TOKEN}`);
  });

  it('round-trips through parseInviteToken', () => {
    const link = buildInviteLink('https://app.example', '/', TOKEN);
    expect(parseInviteToken(link.split('#/join/')[1])).toBe(TOKEN);
  });
});

describe('inviteMessage / buildWhatsAppUrl', () => {
  const link = buildInviteLink('https://app.example', '/', TOKEN);

  it('names the kitchen, states the 72 hour window and carries the link', () => {
    const m = inviteMessage('Sunset', link);
    expect(m).toContain('Sunset');
    expect(m).toContain('72');
    expect(m).toContain(link);
  });

  it('still reads correctly with no kitchen name', () => {
    expect(inviteMessage(undefined, link)).toContain('הוזמנת להצטרף למטבח');
    expect(inviteMessage('   ', link)).not.toContain('למטבח  ');
  });

  it('encodes Hebrew and the link for the wa.me query', () => {
    const url = buildWhatsAppUrl(inviteMessage('Sunset', link));
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(url).not.toContain(' ');
    expect(url).not.toContain('#');
    expect(decodeURIComponent(url.split('text=')[1])).toContain(link);
  });
});
