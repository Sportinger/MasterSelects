import { describe, expect, it, vi } from 'vitest';
import { createObservableScoreEditorState } from '../../src/components/scoreEditor/scoreEditorState';

describe('score editor external state', () => {
  it('publishes React commands through the same state observed by controllers', () => {
    const observable = createObservableScoreEditorState();
    const controllerState = observable.state;
    const listener = vi.fn();
    const unsubscribe = observable.subscribe(listener);
    observable.update({ selectedTool: 'selection', selectedNoteId: 'note-1' });
    expect(controllerState.selectedTool).toBe('selection');
    expect(controllerState.selectedNoteId).toBe('note-1');
    expect(observable.getVersion()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    observable.update({ selectedTool: 'selection' });
    expect(observable.getVersion()).toBe(2);
    controllerState.selectedNoteId = null;
    expect(observable.getVersion()).toBe(3);
    unsubscribe();
    observable.update({ selectedTool: 'entry' });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
