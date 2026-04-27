// App version
// Format: MAJOR.MINOR.PATCH
export const APP_VERSION = '1.6.5';

export interface ChangelogNotice {
  type: 'info' | 'warning' | 'success' | 'danger';
  title: string;
  message: string;
  animated?: boolean;
  link?: {
    label: string;
    href: string;
    suffix?: string;
  };
  annotation?: {
    text: string;
  };
}

// Featured video shown at top of changelog (set to null to hide)
export const FEATURED_VIDEO: {
  youtubeId: string;
  title: string;
  banner?: ChangelogNotice;
} | null = {
  youtubeId: '5ezX5ra0RTI',
  title: 'MasterSelects Demo',
  banner: {
    type: 'success',
    title: 'Gaussian Splats are Live!',
    message: 'Import and play gaussian splat scenes directly in the timeline.',
    animated: true,
  },
};

// Build/Platform notice shown at top of changelog (set to null to hide)
export const BUILD_NOTICE: ChangelogNotice | null = {
  type: 'warning',
  title: 'Work in progress',
  message: '',
  link: {
    label: 'MatAnyone2',
    href: 'https://github.com/pq-yang/MatAnyone2',
    suffix: 'integration',
  },
  animated: true,
};

export const WIP_NOTICE: ChangelogNotice | null = {
  type: 'success',
  title: 'Payments are Live',
  message: 'If you want to buy AI credit, you can do that now. Your own AI key is optional.',
  animated: true,
};

// Change entry type (used by UI)
export interface ChangeEntry {
  type: 'new' | 'fix' | 'improve' | 'refactor';
  title: string;
  description?: string;
  section?: string; // Optional section header to create visual dividers
  commits?: string[]; // Git commit hashes for linking to GitHub
  highlight?: 'community';
  contributorName?: string;
  contributorUrl?: string;
}

// Time-grouped changelog entry
export interface TimeGroupedChanges {
  label: string;
  dateRange: string; // "Jan 20" or "Jan 13-19" etc
  changes: ChangeEntry[];
}

export interface ChangelogCalendarDay {
  date: string;
  tooltip: string;
  count: number;
  communityCount: number;
  level: 0 | 1 | 2 | 3 | 4;
  communityLevel: 0 | 1 | 2 | 3 | 4;
  isFuture: boolean;
  isToday: boolean;
  isOutOfRange: boolean;
}

// Raw changelog entry as stored in changelog-data.json
export interface RawChangeEntry {
  date: string; // ISO date string YYYY-MM-DD
  type: 'new' | 'fix' | 'improve' | 'refactor';
  title: string;
  description?: string;
  section?: string;
  commits?: string[];
  highlight?: 'community';
  contributorName?: string;
  contributorUrl?: string;
}

export function shouldAutoShowChangelog(
  showChangelogOnStartup: boolean,
  lastSeenChangelogVersion: string | null | undefined,
  appVersion: string = APP_VERSION,
): boolean {
  return showChangelogOnStartup || lastSeenChangelogVersion !== appVersion;
}

// Import changelog data from JSON
import changelogData from './changelog-data.json';
const RAW_CHANGELOG: RawChangeEntry[] = changelogData as RawChangeEntry[];

function parseISODateLocal(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateRange(minDate: Date, maxDate: Date): string {
  if (minDate.getTime() === maxDate.getTime()) {
    return formatDateShort(maxDate);
  }

  const sameMonth = minDate.getFullYear() === maxDate.getFullYear() && minDate.getMonth() === maxDate.getMonth();
  if (sameMonth) {
    return `${maxDate.toLocaleDateString('en-US', { month: 'short' })} ${minDate.getDate()}-${maxDate.getDate()}`;
  }

  return `${formatDateShort(minDate)} - ${formatDateShort(maxDate)}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeekMonday(date: Date): Date {
  const day = date.getDay();
  const offset = (day + 6) % 7;
  const normalized = startOfDay(date);
  normalized.setDate(normalized.getDate() - offset);
  return normalized;
}

function endOfWeekMonday(date: Date): Date {
  const normalized = startOfWeekMonday(date);
  normalized.setDate(normalized.getDate() + 6);
  return normalized;
}

function startOfQuarter(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

function formatCalendarTooltip(date: Date, count: number, communityCount: number): string {
  const label = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (count === 0) {
    return label;
  }
  if (communityCount === 0) {
    return `${label}: ${count} ${count === 1 ? 'change' : 'changes'}`;
  }

  const coreCount = Math.max(0, count - communityCount);
  const countLabel = `${count} ${count === 1 ? 'change' : 'changes'}`;
  const communityLabel = `${communityCount} community`;
  const coreLabel = coreCount > 0 ? `, ${coreCount} core` : '';
  return `${label}: ${countLabel} (${communityLabel}${coreLabel})`;
}

function getCalendarLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count >= 4) return 4;
  if (count === 3) return 3;
  if (count === 2) return 2;
  if (count === 1) return 1;
  return 0;
}

function getMonthDiff(now: Date, date: Date): number {
  return (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
}

function formatMonthLabel(date: Date, now: Date): string {
  const includeYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleDateString('en-US', includeYear
    ? { month: 'long', year: 'numeric' }
    : { month: 'long' });
}

function getInitialCommitDate(entries: RawChangeEntry[]): Date | null {
  if (entries.length === 0) {
    return null;
  }

  return entries
    .map((entry) => parseISODateLocal(entry.date))
    .reduce((earliest, date) => (date < earliest ? date : earliest));
}

// Calculate relative time labels based on current date
function getTimeLabel(
  date: Date,
  now: Date,
  initialCommitDate: Date | null
): { label: string; sortOrder: number } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const normalizedDate = startOfDay(date);
  const dayDiff = Math.round((today.getTime() - normalizedDate.getTime()) / dayMs);
  const monthDiff = getMonthDiff(today, normalizedDate);

  if (dayDiff <= 0) {
    return { label: 'Today', sortOrder: 0 };
  }
  if (dayDiff === 1) {
    return { label: 'Yesterday', sortOrder: 1 };
  }
  if (dayDiff === 2) {
    return { label: 'Day Before Yesterday', sortOrder: 2 };
  }
  if (dayDiff < 7) {
    return { label: 'Last Week', sortOrder: 3 };
  }
  if (monthDiff === 0) {
    return { label: formatMonthLabel(normalizedDate, now), sortOrder: 4 };
  }
  if (monthDiff === 1) {
    return { label: 'Last Month', sortOrder: 5 };
  }
  if (
    initialCommitDate &&
    startOfDay(initialCommitDate).getTime() === normalizedDate.getTime()
  ) {
    return { label: 'Initial Commit', sortOrder: 10_000 };
  }
  return { label: formatMonthLabel(normalizedDate, now), sortOrder: 5 + monthDiff };
}

// Group changes by time period
export function getGroupedChangelog(
  entries: RawChangeEntry[] = RAW_CHANGELOG,
  now: Date = new Date()
): TimeGroupedChanges[] {
  const groups = new Map<string, { sortOrder: number; minDate: Date; maxDate: Date; changes: ChangeEntry[] }>();
  const initialCommitDate = getInitialCommitDate(entries);

  for (const entry of entries) {
    const date = parseISODateLocal(entry.date);
    const { label, sortOrder } = getTimeLabel(date, now, initialCommitDate);

    if (!groups.has(label)) {
      groups.set(label, { sortOrder, minDate: date, maxDate: date, changes: [] });
    }

    const group = groups.get(label)!;
    if (date < group.minDate) group.minDate = date;
    if (date > group.maxDate) group.maxDate = date;
    group.changes.push({
      type: entry.type,
      title: entry.title,
      description: entry.description,
      section: entry.section,
      commits: entry.commits,
      highlight: entry.highlight,
      contributorName: entry.contributorName,
      contributorUrl: entry.contributorUrl,
    });
  }

  // Sort groups by sortOrder and return
  return Array.from(groups.entries())
    .map(([label, data]) => ({
      label,
      dateRange: formatDateRange(data.minDate, data.maxDate),
      changes: data.changes,
    }))
    .sort((a, b) => {
      const orderA = groups.get(a.label)?.sortOrder ?? 99;
      const orderB = groups.get(b.label)?.sortOrder ?? 99;
      return orderA - orderB;
    });
}

export function getChangelogCalendar(
  entries: RawChangeEntry[] = RAW_CHANGELOG,
  now: Date = new Date(),
  scope: 'year' | 'quarter' | number = 'year'
): ChangelogCalendarDay[][] {
  const normalizedNow = startOfDay(now);
  const countsByDate = new Map<string, number>();
  const communityCountsByDate = new Map<string, number>();
  for (const entry of entries) {
    countsByDate.set(entry.date, (countsByDate.get(entry.date) ?? 0) + 1);
    if (entry.highlight === 'community') {
      communityCountsByDate.set(entry.date, (communityCountsByDate.get(entry.date) ?? 0) + 1);
    }
  }

  let firstWeekStart: Date;
  let weeks: number;
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;

  if (scope === 'quarter' || scope === 'year') {
    rangeStart = scope === 'year'
      ? startOfYear(normalizedNow)
      : startOfQuarter(normalizedNow);
    rangeEnd = normalizedNow;
    firstWeekStart = startOfWeekMonday(rangeStart);
    const finalWeekEnd = endOfWeekMonday(rangeEnd);
    weeks = Math.ceil((finalWeekEnd.getTime() - firstWeekStart.getTime() + 1) / (7 * 24 * 60 * 60 * 1000));
  } else {
    const currentWeekStart = startOfWeekMonday(normalizedNow);
    firstWeekStart = new Date(currentWeekStart);
    firstWeekStart.setDate(firstWeekStart.getDate() - (scope - 1) * 7);
    weeks = scope;
  }

  const weeksGrid: ChangelogCalendarDay[][] = [];
  for (let weekIndex = 0; weekIndex < weeks; weekIndex++) {
    const weekStart = new Date(firstWeekStart);
    weekStart.setDate(firstWeekStart.getDate() + weekIndex * 7);

    const days: ChangelogCalendarDay[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + dayIndex);

      const isoDate = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
      const isOutOfRange = !!(rangeStart && rangeEnd && (date < rangeStart || date > rangeEnd));
      const isFuture = !isOutOfRange && date.getTime() > normalizedNow.getTime();
      const count = isOutOfRange || isFuture ? 0 : (countsByDate.get(isoDate) ?? 0);
      const communityCount = isOutOfRange || isFuture ? 0 : (communityCountsByDate.get(isoDate) ?? 0);

      days.push({
        date: isoDate,
        tooltip: isOutOfRange ? '' : formatCalendarTooltip(date, count, communityCount),
        count,
        communityCount,
        level: isOutOfRange || isFuture ? 0 : getCalendarLevel(count),
        communityLevel: isOutOfRange || isFuture ? 0 : getCalendarLevel(communityCount),
        isFuture,
        isToday: !isOutOfRange && date.getTime() === normalizedNow.getTime(),
        isOutOfRange,
      });
    }

    weeksGrid.push(days);
  }

  return weeksGrid;
}

// Known issues and bugs - shown in What's New dialog
// Remove items when fixed
export const KNOWN_ISSUES: string[] = [
  'YouTube download requires Native Helper with yt-dlp installed',
  'Audio waveforms may not display for some video formats',
  'Very long videos (>2 hours) may cause performance issues',
];
