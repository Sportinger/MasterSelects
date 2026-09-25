import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { createNotebookEditorDocument } from '../../src/services/documents/notebookEditorModel';
import { nextScreenplayKind, splitScreenplayBlock } from '../../src/services/documents/notebookScreenplayCommands';
import type { ProjectDocument } from '../../src/types/documents';

const screenplay = (kind: ProjectDocument['blocks'][number]['kind'], text: string): ProjectDocument => ({
  id: 'script', title: 'Night Shift', kind: 'screenplay', schemaVersion: 2,
  revision: 1, createdAt: 1, updatedAt: 1,
  blocks: [{ id: 'first', kind, text }], links: [], comments: [], labels: [], scenes: [], formats: [],
  screenplay: { pageSize: 'letter', sceneNumbers: false, revisions: [] },
});

function stateAt(kind: ProjectDocument['blocks'][number]['kind'], text: string, offset: number) {
  const doc = createNotebookEditorDocument(screenplay(kind, text));
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, offset + 1)));
}

describe('Notebook screenplay writing commands', () => {
  it('advances a scene heading to action while preserving its text', () => {
    const state = stateAt('scene', 'INT. STUDIO - NIGHT', 'INT. STUDIO - NIGHT'.length);
    let next = state;
    expect(splitScreenplayBlock(state, transaction => { next = state.apply(transaction); },
      nextScreenplayKind('scene'))).toBe(true);
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).textContent).toBe('INT. STUDIO - NIGHT');
    expect(next.doc.child(1).attrs.kind).toBe('action');
  });

  it('splits a nonempty action at the cursor for explicit advancement', () => {
    const state = stateAt('action', 'A door opens.', 1);
    let next = state;
    expect(splitScreenplayBlock(state, transaction => { next = state.apply(transaction); },
      nextScreenplayKind('action'))).toBe(true);
    expect(next.doc.child(0).textContent).toBe('A');
    expect(next.doc.child(1).textContent).toBe(' door opens.');
    expect(next.doc.child(1).attrs.kind).toBe('action');
  });

  it('keeps screenplay follow rules separate from normal paragraphs', () => {
    expect(nextScreenplayKind('character')).toBe('dialogue');
    expect(nextScreenplayKind('parenthetical')).toBe('dialogue');
    expect(nextScreenplayKind('transition')).toBe('scene');
  });
});
