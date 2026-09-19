import { describe, expect, it } from 'vitest';
import { shouldShowEditorProjectSelection } from '../../src/routing/editorProjectSelectionState';

describe('editor project selection state', () => {
  it('shows the project chooser only for a direct editor entry without an open project', () => {
    expect(shouldShowEditorProjectSelection('editor', false)).toBe(true);
    expect(shouldShowEditorProjectSelection('medium', false)).toBe(true);
    expect(shouldShowEditorProjectSelection('editor', true)).toBe(false);
    expect(shouldShowEditorProjectSelection('medium', true)).toBe(false);
    expect(shouldShowEditorProjectSelection('chat', false)).toBe(false);
  });

  it('keeps a stored project permission restore from being covered by the chooser', () => {
    expect(shouldShowEditorProjectSelection('editor', false, true)).toBe(false);
  });
});
