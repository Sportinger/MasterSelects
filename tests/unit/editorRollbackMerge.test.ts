import { beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../../src/services/logger';
import { revertFieldWrite } from '../../src/services/project/repository/transaction/editorRollbackMerge';

describe('revertFieldWrite: a cancelled write keeps what others changed meanwhile', () => {
  const a = { id: 'a', name: 'A' }, b = { id: 'b', name: 'B' }, c = { id: 'c', name: 'C' };

  it('returns the earlier value when nothing changed since the write', () => {
    const before = [a], after = [a, b];
    expect(revertFieldWrite(after, before, after)).toBe(before);
  });

  it('reverts only the items the write changed in an id list', () => {
    const renamedA = { ...a, name: 'A by tool' }, renamedB = { ...b, name: 'B by user' };
    const before = [a, b], after = [renamedA, b, c];
    // Later, another transaction renamed b.
    const current = [renamedA, renamedB, c];
    expect(revertFieldWrite(current, before, after)).toEqual([a, renamedB]);
  });

  it('puts back an item the write removed', () => {
    const before = [a, b, c], after = [a, c];
    const userC = { ...c, name: 'C by user' };
    expect(revertFieldWrite([a, userC], before, after)).toEqual([a, b, userC]);
  });

  it('reverts Map keys and Set members per entry', () => {
    const before = new Map([['x', 1]]), after = new Map([['x', 2], ['y', 3]]);
    expect([...(revertFieldWrite(new Map([['x', 2], ['y', 3], ['z', 9]]), before, after) as Map<string, number>)])
      .toEqual([['x', 1], ['z', 9]]);
    const beforeSet = new Set(['p']), afterSet = new Set(['q']);
    expect([...(revertFieldWrite(new Set(['q', 'r']), beforeSet, afterSet) as Set<string>)].sort()).toEqual(['p', 'r']);
  });

  it('keeps a plain value another transaction replaced after the write', () => {
    expect(revertFieldWrite(30, 10, 20)).toBe(30);
    expect(revertFieldWrite(20, 10, 20)).toBe(10);
  });

  describe('plain arrays and records changed by another transaction too', () => {
    beforeEach(() => Logger.clear());
    const warnings = (text: string) => Logger.search(text).filter(entry => entry.level === 'WARN');

    it('reverts a unique id list per element: the tab the failed tool opened closes, the user\'s stays', () => {
      const before = ['main'], after = ['main', 'duplicate'];
      // During the tool's await the user opened another tab.
      expect(revertFieldWrite(['main', 'duplicate', 'user'], before, after, 'media.openCompositionIds')).toEqual(['main', 'user']);
      // A removal comes back at its earlier place.
      expect(revertFieldWrite(['a', 'c', 'd'], ['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'b', 'c', 'd']);
    });

    it('returns the earlier list when another write left the same entries', () => {
      const before = ['a'];
      expect(revertFieldWrite(['a', 'b'], before, ['a', 'b'])).toBe(before);
    });

    it('logs instead of guessing when a list has repeated values or the write only reordered it', () => {
      expect(revertFieldWrite(['x', 'x', 'y'], ['x'], ['x', 'x'], 'timeline.order')).toEqual(['x', 'x', 'y']);
      expect(warnings('timeline.order')).toHaveLength(1);
      expect(revertFieldWrite(['b', 'a', 'c'], ['a', 'b'], ['b', 'a'], 'timeline.lanes')).toEqual(['b', 'a', 'c']);
      expect(warnings('timeline.lanes')).toHaveLength(1);
    });

    it('reverts a record per key and logs a key another transaction changed too', () => {
      const before = { s1: 'clip-a', s2: 'clip-b' }, after = { s1: 'clip-x', s2: 'clip-y', s3: 'clip-z' };
      const current = { s1: 'clip-x', s2: 'clip-user', s3: 'clip-z', s4: 'clip-other' };
      expect(revertFieldWrite(current, before, after, 'media.slotAssignments')).toEqual({ s1: 'clip-a', s2: 'clip-user', s4: 'clip-other' });
      const [warning] = warnings('media.slotAssignments');
      expect(warning?.message).toContain('s2');
    });
  });
});
