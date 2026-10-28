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

  describe('identified lists changed by another transaction too', () => {
    beforeEach(() => Logger.clear());
    const warnings = (text: string) => Logger.search(text).filter(entry => entry.level === 'WARN');
    type Clip = { id: string; opacity: number; waveform?: string; isLoading?: boolean };
    const clip: Clip = { id: 'c', opacity: 1, isLoading: true };

    it('reverts only the keys the write changed in an item a later write replaced (a load result stays)', () => {
      const byTool = { ...clip, opacity: 0.5 };
      // During the tool's await a load result replaced the clip with its runtime fields.
      const loaded = { ...byTool, waveform: 'peaks', isLoading: false };
      expect(revertFieldWrite([loaded], [clip], [byTool], 'timeline.clips'))
        .toEqual([{ id: 'c', opacity: 1, waveform: 'peaks', isLoading: false }]);
      expect(warnings('timeline.clips')).toHaveLength(0);
    });

    it('keeps a key another write changed too and logs it', () => {
      const byTool = { ...clip, opacity: 0.5 };
      const byUser = { ...byTool, opacity: 0.8, waveform: 'peaks' };
      expect(revertFieldWrite([byUser], [clip], [byTool], 'timeline.clips')).toEqual([byUser]);
      expect(warnings('timeline.clips')[0]?.message).toContain('opacity');
    });

    it('leaves an item removed by a later write removed', () => {
      const a = { id: 'a', opacity: 1 }, b = { id: 'b', opacity: 1 };
      const byTool = { ...b, opacity: 0.2 };
      // The tool changed b; the user deleted b afterwards, and also edited a.
      expect(revertFieldWrite([{ ...a, opacity: 0.4 }], [a, b], [a, byTool])).toEqual([{ ...a, opacity: 0.4 }]);
    });

    it('takes back a pure reorder when a later write changed items but not the order', () => {
      const a = { id: 'a', opacity: 1 }, b = { id: 'b', opacity: 1 };
      const loadedA = { ...a, waveform: 'peaks' };
      expect(revertFieldWrite([b, loadedA], [a, b], [b, a], 'timeline.tracks')).toEqual([loadedA, b]);
    });

    it('keeps a reorder another write reordered again and logs it', () => {
      const a = { id: 'a', opacity: 1 }, b = { id: 'b', opacity: 1 }, c = { id: 'c', opacity: 1 };
      expect(revertFieldWrite([c, b, a], [a, b, c], [b, a, c], 'timeline.tracks')).toEqual([c, b, a]);
      expect(warnings('timeline.tracks')).toHaveLength(1);
    });
  });
});
