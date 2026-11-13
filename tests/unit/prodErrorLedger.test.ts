import { describe, expect, it } from 'vitest';
import { STATES, buildLedger, classifyGroup, versionNumber } from '../../scripts/prod-error-ledger.mjs';

const seen = (version: string, people = 1) => [{ version, people, last: '2026-11-01T00:00:00Z' }];

// On 2026-11-02, 381 of 498 groups had no status and 17 "fixed" groups were in no release, so every
// agent had to find out again what was already handled.
describe('production error ledger', () => {
  it('compares versions as numbers', () => {
    expect(versionNumber('3.10.0')).toBeGreaterThan(versionNumber('3.9.9'));
    expect(versionNumber(null)).toBe(0);
  });

  it('shows a group without a status as work to do', () => {
    expect(classifyGroup(null, seen('3.4.3'), null)).toBe(STATES.UNMARKED);
  });

  it('keeps open states and ignored groups apart', () => {
    expect(classifyGroup({ status: 'investigating' }, seen('3.4.3'), null)).toBe(STATES.OPEN);
    expect(classifyGroup({ status: 'requested' }, seen('3.4.3'), null)).toBe(STATES.OPEN);
    expect(classifyGroup({ status: 'ignored' }, seen('3.4.3'), null)).toBe(STATES.IGNORED);
  });

  it('does not call a fix released while its commit is in no release', () => {
    expect(classifyGroup({ status: 'fixed', revision: 'abc1234' }, seen('3.4.3'), { version: null })).toBe(STATES.UNRELEASED);
  });

  it('confirms a fix only while the error stays away from versions containing it', () => {
    const fixed = { status: 'fixed', revision: 'abc1234' };
    expect(classifyGroup(fixed, seen('3.4.2'), { version: '3.4.3' })).toBe(STATES.FIXED);
    expect(classifyGroup(fixed, seen('3.4.3'), { version: '3.4.3' })).toBe(STATES.RETURNED);
    expect(classifyGroup(fixed, seen('3.4.3', 0), { version: '3.4.3' }), 'crawlers alone do not reopen it').toBe(STATES.FIXED);
  });

  it('watches a group closed because it stopped happening, but not browser noise', () => {
    const at = Date.parse('2026-11-02T00:00:00Z');
    const later = [{ version: '3.5.0', people: 1, last: '2026-11-05T00:00:00Z' }];
    expect(classifyGroup({ status: 'ignored', at, note: 'Not seen since 3.1.8' }, seen('3.1.8'), null)).toBe(STATES.IGNORED);
    expect(classifyGroup({ status: 'ignored', at, note: 'Not seen since 3.1.8' }, later, null)).toBe(STATES.RETURNED);
    expect(classifyGroup({ status: 'ignored', at, note: 'Injected by an in-app browser' }, later, null)).toBe(STATES.IGNORED);
  });

  it('joins telemetry with the status of the owner, then of the repair loop', () => {
    const ledger = buildLedger({
      versions: [
        { fp: 'aaaa', version: '3.4.3', sessions: 5, crawlers: 2, last: '2026-11-02T00:00:00Z' },
        { fp: 'aaaa', version: '3.4.2', sessions: 1, crawlers: 0, last: '2026-10-30T00:00:00Z' },
        { fp: 'bbbb', version: '3.4.3', sessions: 1, crawlers: 1, last: '2026-11-01T00:00:00Z' },
      ],
      messages: new Map([['aaaa', 'Some  failure']]),
      statuses: { 'issue:aaaa': { status: 'ignored', note: 'browser script' } },
      loopStatuses: { aaaa: { status: 'fixed' }, bbbb: { status: 'ignored' } },
      releases: [],
    });
    expect(ledger.find((group: { fingerprint: string }) => group.fingerprint === 'aaaa')).toMatchObject({
      state: STATES.IGNORED, people: 4, lastVersion: '3.4.3', lastSeen: '2026-11-02T00:00:00Z', note: 'browser script', message: 'Some failure',
    });
    expect(ledger.find((group: { fingerprint: string }) => group.fingerprint === 'bbbb')).toMatchObject({ state: STATES.IGNORED, people: 0 });
  });
});
