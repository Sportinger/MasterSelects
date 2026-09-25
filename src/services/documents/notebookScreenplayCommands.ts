import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { DocumentBlockKind } from '../../types/documents';
import { notebookEditorSchema } from './notebookEditorModel';

export function nextScreenplayKind(kind: DocumentBlockKind): DocumentBlockKind {
  switch (kind) {
    case 'scene': return 'action';
    case 'character': case 'parenthetical': case 'dual-dialogue': return 'dialogue';
    case 'transition': case 'page-break': return 'scene';
    case 'dialogue': return 'character';
    default: return 'action';
  }
}

export function splitScreenplayBlock(state: EditorState, dispatch: ((transaction: Transaction) => void) | undefined,
  kind: DocumentBlockKind): boolean {
  if (!state.selection.empty || !state.selection.$from.parent.isTextblock) return false;
  const position = state.selection.from;
  const transaction = state.tr.split(position, 1,
    [{ type: notebookEditorSchema.nodes.paragraph, attrs: { kind } }]);
  transaction.setSelection(TextSelection.create(transaction.doc, position + 2));
  if (dispatch) dispatch(transaction.scrollIntoView());
  return true;
}
