import { describe, expect, it } from 'vitest';
import { isClientOutdated } from '../appConfig';

// The bias under test is fail-open: a version this code cannot confidently read must never lock
// a kitchen out. Every "can't tell" case below asserts `false`.

describe('isClientOutdated', () => {
  it('locks out a build below the minimum', () => {
    expect(isClientOutdated('1.2.0', '1.3.0')).toBe(true);
    expect(isClientOutdated('1.2.9', '1.3')).toBe(true);
    expect(isClientOutdated('0.9.0', '1.0.0')).toBe(true);
  });

  it('lets an equal or newer build through', () => {
    expect(isClientOutdated('1.3.0', '1.3.0')).toBe(false);
    expect(isClientOutdated('1.3.1', '1.3.0')).toBe(false);
    expect(isClientOutdated('2.0.0', '1.9.9')).toBe(false);
  });

  it('treats a missing segment as zero rather than as newer', () => {
    expect(isClientOutdated('1.3', '1.3.0')).toBe(false);
    expect(isClientOutdated('1.3', '1.3.1')).toBe(true);
    expect(isClientOutdated('1.3.0.1', '1.3.0')).toBe(false);
  });

  it('compares segments as numbers, not strings', () => {
    // The bug this pins: '10' < '9' lexically, so a string compare would lock out every client
    // once the minor version reached double digits.
    expect(isClientOutdated('1.10.0', '1.9.0')).toBe(false);
    expect(isClientOutdated('1.9.0', '1.10.0')).toBe(true);
  });

  it('ignores a leading v and a trailing suffix', () => {
    expect(isClientOutdated('v1.2.0', '1.3.0')).toBe(true);
    expect(isClientOutdated('1.4.0-rc1', '1.4.0')).toBe(false);
    expect(isClientOutdated('1.3.0+abc123', '1.4.0')).toBe(true);
  });

  it('never locks out a version it cannot read — including the default "dev" build', () => {
    expect(isClientOutdated('dev', '1.0.0')).toBe(false);
    expect(isClientOutdated(undefined, '1.0.0')).toBe(false);
    expect(isClientOutdated('', '1.0.0')).toBe(false);
    expect(isClientOutdated('main-a1b2c3', '1.0.0')).toBe(false);
  });

  it('never locks out when no minimum is set', () => {
    expect(isClientOutdated('1.0.0', null)).toBe(false);
    expect(isClientOutdated('1.0.0', '')).toBe(false);
    expect(isClientOutdated('1.0.0', 'latest')).toBe(false);
  });
});
