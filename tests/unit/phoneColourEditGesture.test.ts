import { beforeEach, describe, expect, it, vi } from 'vitest';

// A colour drag (wheel, curve point, slider) is one undo step: with the project repository every
// change runs inside the gesture its batch opened, and the gesture is committed once at the end.
const mocks = vi.hoisted(() => ({
  repository: true,
  opened: true,
  log: [] as string[],
}));
vi.mock('../../src/stores/historyStore', () => ({
  startBatch: (label: string) => { mocks.log.push(`start ${label}`); return { opened: mocks.opened, batchId: mocks.opened ? 7 : null }; },
  endBatch: () => mocks.log.push('end'),
  cancelHistoryBatch: () => mocks.log.push('cancel-batch'),
}));
vi.mock('../../src/services/project/repository/transaction/editorGestureOwnership', () => ({
  runEditorGesture: (id: number, action: () => unknown) => { mocks.log.push(`run ${id}`); return action(); },
  finishEditorGesture: (id: number, cancel = false) => mocks.log.push(`finish ${id}${cancel ? ' cancel' : ''}`),
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => (mocks.repository ? {} : null),
}));

import { beginColorEditGesture, runColorEditGesture } from '../../src/components/panels/color/colorEditGesture';

beforeEach(() => { mocks.repository = true; mocks.opened = true; mocks.log = []; });

describe('colour edit gesture', () => {
  it('runs every change of a drag inside one repository gesture and commits it once', () => {
    const gesture = beginColorEditGesture('Adjust color');
    gesture.run(() => mocks.log.push('gainR'));
    gesture.run(() => mocks.log.push('gainG'));
    gesture.commit();
    gesture.commit();
    gesture.run(() => mocks.log.push('late'));
    expect(mocks.log).toEqual(['start Adjust color', 'run 7', 'gainR', 'run 7', 'gainG', 'finish 7', 'end', 'late']);
  });

  it('cancels the repository gesture and the batch together', () => {
    const gesture = beginColorEditGesture('Adjust color curve');
    gesture.cancel();
    expect(mocks.log).toEqual(['start Adjust color curve', 'finish 7 cancel', 'cancel-batch']);
  });

  it('joins an outer batch without closing it, and works without the repository', () => {
    mocks.opened = false;
    const nested = beginColorEditGesture('Adjust color');
    nested.run(() => mocks.log.push('change'));
    nested.commit();
    expect(mocks.log).toEqual(['start Adjust color', 'change']);
    mocks.log = []; mocks.opened = true; mocks.repository = false;
    expect(runColorEditGesture('Reset color curve', () => 'done')).toBe('done');
    expect(mocks.log).toEqual(['start Reset color curve', 'end']);
  });

  it('cancels when the grouped change throws', () => {
    expect(() => runColorEditGesture('Set color keyframes', () => { throw new Error('boom'); })).toThrow('boom');
    expect(mocks.log).toEqual(['start Set color keyframes', 'run 7', 'finish 7 cancel', 'cancel-batch']);
  });
});
