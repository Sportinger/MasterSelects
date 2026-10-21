import { describe, expect, it } from 'vitest';
import { orderRecentProjectsForChoice, recentProjectLocation } from '../../src/services/project/recentProjectLocation';
import type { RecentProjectEntry } from '../../src/services/project/recentProjects';

const entry = (name: string, backend: RecentProjectEntry['backend'], store?: RecentProjectEntry['store']) => ({ name, backend, ...(store ? { store } : {}) });

describe('recent project locations', () => {
  it('names folders, helper folders, browser storage and the temporary fallback', () => {
    expect(recentProjectLocation(entry('A', 'fsa'), true)).toBe('Folder');
    expect(recentProjectLocation(entry('A', 'native'), false)).toBe('Native');
    expect(recentProjectLocation(entry('A', 'opfs', 'opfs'), true)).toBe('Browser local');
    expect(recentProjectLocation(entry('A', 'opfs', 'indexeddb'), false)).toBe('Temporary');
  });

  it('decides entries without a remembered store by the store this tab uses', () => {
    expect(recentProjectLocation(entry('A', 'opfs'), true)).toBe('Temporary');
    expect(recentProjectLocation(entry('A', 'opfs'), false)).toBe('Browser local');
  });

  it('lists a permanent project before its temporary copy and keeps the recency order otherwise', () => {
    const entries = [entry('Show', 'opfs', 'indexeddb'), entry('Other', 'opfs', 'indexeddb'), entry('show ', 'fsa'), entry('Third', 'opfs', 'opfs')];
    expect(orderRecentProjectsForChoice(entries, false).map(item => `${item.name.trim()}:${recentProjectLocation(item, false)}`))
      .toEqual(['Other:Temporary', 'show:Folder', 'Show:Temporary', 'Third:Browser local']);
  });
});
