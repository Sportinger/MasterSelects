import { describe, expect, it } from 'vitest';

import {
  getChangelogCalendar,
  getGroupedChangelog,
  shouldAutoShowChangelog,
  type RawChangeEntry,
} from '../../src/version';

describe('getGroupedChangelog', () => {
  it('uses granular recent buckets plus month and initial commit buckets', () => {
    const entries: RawChangeEntry[] = [
      { date: '2026-03-16', type: 'fix', title: 'Today item' },
      { date: '2026-03-15', type: 'fix', title: 'Yesterday item' },
      { date: '2026-03-14', type: 'fix', title: 'Day before yesterday item' },
      { date: '2026-03-10', type: 'fix', title: 'Last week item' },
      { date: '2026-02-05', type: 'fix', title: 'Last month item' },
      { date: '2026-01-10', type: 'fix', title: 'January item' },
      { date: '2026-01-04', type: 'new', title: 'Initial commit item' },
    ];

    const groups = getGroupedChangelog(entries, new Date(2026, 2, 16, 12, 0, 0));

    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Day Before Yesterday',
      'Last Week',
      'Last Month',
      'January',
      'Initial Commit',
    ]);
  });

  it('preserves community highlight metadata on grouped entries', () => {
    const entries: RawChangeEntry[] = [
      {
        date: '2026-03-14',
        type: 'fix',
        title: 'Community item',
        highlight: 'community',
        contributorName: 'Florian Thonig',
        contributorUrl: 'https://github.com/florianthonig',
      },
    ];

    const groups = getGroupedChangelog(entries, new Date(2026, 2, 16, 12, 0, 0));

    expect(groups[0]?.changes[0]).toMatchObject({
      title: 'Community item',
      highlight: 'community',
      contributorName: 'Florian Thonig',
      contributorUrl: 'https://github.com/florianthonig',
    });
  });
});

describe('getChangelogCalendar', () => {
  it('builds a fixed week grid with daily change counts and future-day placeholders', () => {
    const entries: RawChangeEntry[] = [
      { date: '2026-03-16', type: 'fix', title: 'Today item' },
      { date: '2026-03-16', type: 'improve', title: 'Another today item' },
      { date: '2026-03-15', type: 'fix', title: 'Yesterday item' },
    ];

    const calendar = getChangelogCalendar(entries, new Date(2026, 2, 16, 12, 0, 0), 2);

    expect(calendar).toHaveLength(2);
    expect(calendar[0]).toHaveLength(7);
    expect(calendar[1]).toHaveLength(7);
    expect(calendar[1][0]).toMatchObject({
      date: '2026-03-16',
      count: 2,
      level: 2,
      isToday: true,
      isFuture: false,
    });
    expect(calendar[1][1]).toMatchObject({
      date: '2026-03-17',
      count: 0,
      level: 0,
      isFuture: true,
      isOutOfRange: false,
    });
  });

  it('tracks community contributions separately for split calendar slots', () => {
    const entries: RawChangeEntry[] = [
      { date: '2026-03-14', type: 'fix', title: 'Core item' },
      { date: '2026-03-14', type: 'fix', title: 'Community item', highlight: 'community' },
    ];

    const calendar = getChangelogCalendar(entries, new Date(2026, 2, 16, 12, 0, 0), 2);
    const communityDay = calendar.flat().find((day) => day.date === '2026-03-14');

    expect(communityDay).toMatchObject({
      date: '2026-03-14',
      count: 2,
      communityCount: 1,
      level: 2,
      communityLevel: 1,
      isFuture: false,
      isOutOfRange: false,
    });
    expect(communityDay?.tooltip).toContain('1 community');
  });

  it('defaults to the current quarter including leading filler days before quarter start', () => {
    const entries: RawChangeEntry[] = [
      { date: '2026-01-01', type: 'new', title: 'Quarter start item' },
      { date: '2026-03-16', type: 'fix', title: 'Today item' },
    ];

    const calendar = getChangelogCalendar(entries, new Date(2026, 2, 16, 12, 0, 0));

    expect(calendar[0][0]).toMatchObject({
      date: '2025-12-29',
      isOutOfRange: true,
      count: 0,
    });
    expect(calendar[0][3]).toMatchObject({
      date: '2026-01-01',
      isOutOfRange: false,
      count: 1,
      level: 1,
    });
    expect(calendar.at(-1)?.at(-1)).toMatchObject({
      date: '2026-03-22',
      isOutOfRange: true,
      count: 0,
    });
  });
});

describe('shouldAutoShowChangelog', () => {
  it('shows on every startup when the always-show setting is enabled', () => {
    expect(shouldAutoShowChangelog(true, '1.3.6', '1.3.6')).toBe(true);
  });

  it('forces the changelog once after an update even when always-show is disabled', () => {
    expect(shouldAutoShowChangelog(false, '1.3.5', '1.3.6')).toBe(true);
  });

  it('stays hidden after the current version was already acknowledged and always-show is disabled', () => {
    expect(shouldAutoShowChangelog(false, '1.3.6', '1.3.6')).toBe(false);
  });
});
