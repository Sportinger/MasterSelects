import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { endBatch, redo, startBatch, undo, useHistoryStore } from '../../../stores/historyStore';
import { useDocumentsStore } from '../../../stores/documentsStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { DOCUMENT_PASSAGE_MIME, linkDocumentPassageToClip } from '../../../services/documents/documentClipDrop';
import type { DocumentAnchor, DocumentBlockKind, ProjectDocument } from '../../../types/documents';
import { NotebookDetails } from './NotebookDetails';
import { notebookAnchor, notebookAnchorOffsets, notebookOffset, notebookPoint,
  notebookStructuralText } from '../../../services/documents/notebookRange';
import { nextScreenplayKind, splitScreenplayBlock } from '../../../services/documents/notebookScreenplayCommands';
import {
  createNotebookEditorDocument, notebookEditorBlockKinds, notebookEditorFormatRanges,
  notebookEditorOffsetToPosition, notebookEditorPositionToOffset, notebookEditorSchema, notebookEditorText,
} from '../../../services/documents/notebookEditorModel';

const TEXT_KINDS: Array<{ value: DocumentBlockKind; label: string }> = [
  { value: 'paragraph', label: 'Text' }, { value: 'heading', label: 'Heading' },
  { value: 'list', label: 'List' }, { value: 'quote', label: 'Quote' },
  { value: 'code', label: 'Code' }, { value: 'table', label: 'Table' },
];
const SCRIPT_KINDS: Array<{ value: DocumentBlockKind; label: string }> = [
  { value: 'scene', label: 'Scene heading' }, { value: 'action', label: 'Action' },
  { value: 'character', label: 'Character' }, { value: 'dialogue', label: 'Dialogue' },
  { value: 'parenthetical', label: 'Parenthetical' }, { value: 'transition', label: 'Transition' },
  { value: 'dual-dialogue', label: 'Dual dialogue' }, { value: 'page-break', label: 'Page break' },
];

const EMPTY_NOTEBOOK: ProjectDocument = {
  id: '__empty_notebook__', title: '', kind: 'general', schemaVersion: 2, revision: 0,
  createdAt: 0, updatedAt: 0,
  blocks: [{ id: '__empty_notebook_block__', kind: 'paragraph', text: '' }],
  links: [], comments: [], labels: [], scenes: [], formats: [],
};
const notebookPositions = new Map<string, { from: number; to: number }>();

function difference(before: string, after: string): { start: number; end: number; inserted: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < before.length - start && suffix < after.length - start
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return { start, end: before.length - suffix, inserted: after.slice(start, after.length - suffix) };
}

function searchOffsets(text: string, query: string): Array<[number, number]> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const matches: Array<[number, number]> = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    matches.push([index, index + needle.length]);
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }
  return matches;
}

function dropTarget(editor: EditorView, current: ProjectDocument, x: number, y: number,
  purpose: 'scene' | 'word'): { from: number; to: number; anchor: DocumentAnchor; between: boolean } | null {
  const hit = editor.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const selected = editor.state.selection;
  const useSelected = !selected.empty && hit.pos >= selected.from && hit.pos <= selected.to;
  const between = purpose === 'scene' && !useSelected && editor.state.doc.resolve(hit.pos).depth === 0;
  let from = notebookEditorPositionToOffset(editor.state.doc, useSelected ? selected.from : hit.pos);
  let to = notebookEditorPositionToOffset(editor.state.doc, useSelected ? selected.to : hit.pos);
  if (!useSelected && !between) {
    const point = notebookPoint(current.blocks, from);
    const block = current.blocks.find(item => item.id === point.blockId);
    if (block) {
      if (purpose === 'scene') { from -= point.offset; to = from + block.text.length; }
      else {
        from -= block.text.slice(0, point.offset).match(/[\p{L}\p{N}_-]+$/u)?.[0].length ?? 0;
        to += block.text.slice(point.offset).match(/^[\p{L}\p{N}_-]+/u)?.[0].length ?? 0;
      }
    }
  }
  return { from, to, anchor: notebookAnchor(current.blocks, from, to), between };
}

export function NotebookWritingEditor({ document, query = '', navigationRequest, focusWriting = false }: {
  document: ProjectDocument | null; query?: string;
  navigationRequest?: { id: number; documentId: string; blockId: string } | null;
  focusWriting?: boolean;
}) {
  const notebook = document ?? EMPTY_NOTEBOOK;
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const localDocument = useRef<ProjectDocument | null>(null);
  const createdFromEmpty = useRef(false);
  const createdDocumentId = useRef<string | null>(null);
  const typingTimer = useRef<number | null>(null);
  const queryRef = useRef(query);
  const kindRef = useRef(notebook.kind);
  kindRef.current = notebook.kind;
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [matches, setMatches] = useState<Array<[number, number]>>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [blockKind, setSelectedKind] = useState<DocumentBlockKind>('paragraph');
  const [composer, setComposer] = useState<'label' | 'comment' | null>(null);
  const [composerText, setComposerText] = useState('');
  const [pendingAnchor, setPendingAnchor] = useState<DocumentAnchor | null>(null);
  const [notice, setNotice] = useState('');
  const [dropPreview, setDropPreview] = useState<[number, number] | null>(null);
  const media = useMediaStore(state => state.files);
  const activeCompositionId = useMediaStore(state => state.activeCompositionId);
  const selectedClipId = useTimelineStore(state => state.primarySelectedClipId);

  useEffect(() => {
    setComposer(null);
    setComposerText('');
    setPendingAnchor(null);
    setDropPreview(null);
  }, [notebook.id]);

  useLayoutEffect(() => {
    if (!mount.current) return;
    const id = notebook.id;
    const state = EditorState.create({ doc: createNotebookEditorDocument(notebook),
      plugins: [
        keymap({
          'Mod-z': () => { endBatch(); undo(); return true; },
          'Mod-Shift-z': () => { endBatch(); redo(); return true; },
          'Mod-y': () => { endBatch(); redo(); return true; },
          'Mod-b': toggleMark(notebookEditorSchema.marks.bold),
          'Mod-i': toggleMark(notebookEditorSchema.marks.italic),
          'Mod-Enter': (state, dispatch, editorView) => {
            if (kindRef.current !== 'screenplay') return false;
            const kind = state.selection.$from.parent.attrs.kind as DocumentBlockKind;
            void editorView;
            return splitScreenplayBlock(state, dispatch, nextScreenplayKind(kind));
          },
          'Enter': (state, dispatch, editorView) => {
            if (kindRef.current !== 'screenplay' || !state.selection.empty) return false;
            const block = state.selection.$from.parent;
            const kind = block.attrs.kind as DocumentBlockKind;
            if (state.selection.$from.parentOffset !== block.content.size) return false;
            if (kind === 'dialogue' && block.content.size === 0) {
              return setBlockType(notebookEditorSchema.nodes.paragraph, { kind: 'action' })(state, dispatch, editorView);
            }
            if (!['scene', 'character', 'parenthetical', 'transition', 'dual-dialogue', 'page-break'].includes(kind)) return false;
            void editorView;
            return splitScreenplayBlock(state, dispatch, nextScreenplayKind(kind));
          },
          'Shift-Enter': (state, dispatch) => {
            if (dispatch) dispatch(state.tr.replaceSelectionWith(notebookEditorSchema.nodes.hard_break.create()).scrollIntoView());
            return true;
          },
        }),
        keymap(baseKeymap),
      ] });
    const editor = new EditorView(mount.current, {
      state,
      attributes: { 'aria-label': 'Notebook writing area', 'data-testid': 'notebook-editor',
        spellcheck: 'true' },
      handleDOMEvents: {
        blur: () => {
          if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
          typingTimer.current = null;
          endBatch();
          return false;
        },
        keydown: (_view, event) => {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return true;
          if (event.key === 'Escape') setDropPreview(null);
          return false;
        },
        keyup: (_view, event) => { event.stopPropagation(); return false; },
        dragover: (_view, event) => {
          if (event.dataTransfer?.types.some(type => [
            'application/x-ms-notebook-scene', 'application/x-ms-notebook-label',
            'application/x-media-file-id', 'application/x-media-panel-item', 'application/x-ms-annotation',
          ].includes(type))) {
            event.preventDefault();
            const current = useDocumentsStore.getState().documents.find(item => item.id === id);
            const purpose = event.dataTransfer.types.includes('application/x-ms-notebook-scene') ? 'scene' : 'word';
            const target = current && dropTarget(editor, current, event.clientX, event.clientY, purpose);
            setDropPreview(target ? [target.from, target.to] : null);
          }
          return false;
        },
        dragleave: (_view, event) => {
          if (!editor.dom.contains(event.relatedTarget as Node)) setDropPreview(null);
          return false;
        },
        drop: (_view, event) => {
          setDropPreview(null);
          const transfer = event.dataTransfer;
          if (!transfer) return false;
          const kind = transfer.getData('application/x-ms-notebook-scene') ? 'scene'
            : transfer.getData('application/x-ms-notebook-label') ? 'label' : null;
          const mediaId = transfer.getData('application/x-media-file-id')
            || transfer.getData('application/x-media-panel-item');
          const annotationPayload = transfer.getData('application/x-ms-annotation');
          if (!kind && !mediaId && !annotationPayload) return false;
          const current = useDocumentsStore.getState().documents.find(item => item.id === id);
          const target = current && dropTarget(editor, current, event.clientX, event.clientY,
            kind === 'scene' ? 'scene' : 'word');
          if (!target || !current) return false;
          const { from, to, anchor } = target;
          const store = useDocumentsStore.getState();
          endBatch();
          const batch = startBatch('Drop on Notebook passage');
          try {
            if (kind === 'scene') {
              const overlap = current.scenes?.some(scene => {
                const range = notebookAnchorOffsets(current.blocks, scene.anchor);
                return range && from < range[1] && range[0] < to;
              });
              if (overlap) setNotice('This passage already belongs to a scene.');
              else if (target.between) {
                const point = notebookPoint(current.blocks, from);
                store.replaceRange(id, point, point, '\u2029');
                const changed = useDocumentsStore.getState().documents.find(item => item.id === id);
                if (changed) store.addScene(id, notebookAnchor(changed.blocks, from + 1, from + 1));
              } else store.addScene(id, anchor);
            } else if (kind === 'label') store.addLabel(id, anchor,
              transfer.getData('application/x-ms-notebook-label'));
            else if (mediaId && useMediaStore.getState().files.some(item => item.id === mediaId)) {
              store.addLink(id, anchor, { kind: 'source', mediaId },
                useMediaStore.getState().files.find(item => item.id === mediaId)?.name);
            } else if (annotationPayload) {
              try {
                const parsed = JSON.parse(annotationPayload) as {
                  annotationId?: string; mediaId?: string; compositionId?: string
                };
                if (parsed.annotationId && parsed.mediaId) store.addLink(id, anchor,
                  { kind: 'source-annotation', mediaId: parsed.mediaId, annotationId: parsed.annotationId });
                else if (parsed.annotationId && parsed.compositionId) store.addLink(id, anchor,
                  { kind: 'composition-annotation', compositionId: parsed.compositionId,
                    annotationId: parsed.annotationId });
              } catch { /* Ignore unrelated drag data. */ }
            }
          } finally { if (batch.opened) endBatch(); }
          event.preventDefault();
          event.stopPropagation();
          return true;
        },
      },
      dispatchTransaction(transaction: Transaction) {
        const next = editor.state.apply(transaction);
        editor.updateState(next);
        notebookPositions.set(id, {
          from: notebookEditorPositionToOffset(next.doc, next.selection.from),
          to: notebookEditorPositionToOffset(next.doc, next.selection.to),
        });
        if (transaction.docChanged && queryRef.current) {
          setMatches(searchOffsets(notebookEditorText(next.doc), queryRef.current));
        }
        const selectedBlock = next.selection.$from.parent;
        setSelectedKind((selectedBlock.attrs.kind as DocumentBlockKind) || 'paragraph');
        setSelectionVersion(value => value + 1);
        if (!transaction.docChanged) return;
        if (useHistoryStore.getState().batchId === null) startBatch('Write in Notebook');
        let current = useDocumentsStore.getState().documents.find(item =>
          item.id === (id === EMPTY_NOTEBOOK.id ? createdDocumentId.current : id));
        if (!current && id === EMPTY_NOTEBOOK.id) {
          const createdId = useDocumentsStore.getState().createDocument('', 'general');
          current = useDocumentsStore.getState().documents.find(item => item.id === createdId);
          createdDocumentId.current = createdId;
          const position = notebookPositions.get(id);
          if (position) notebookPositions.set(createdId, position);
          createdFromEmpty.current = true;
        }
        if (!current) return;
        const before = notebookStructuralText(current.blocks);
        const after = notebookEditorText(next.doc);
        const edit = difference(before, after);
        const from = notebookPoint(current.blocks, edit.start);
        const to = notebookPoint(current.blocks, edit.end);
        useDocumentsStore.getState().applyEditorState(current.id, from, to, edit.inserted,
          notebookEditorBlockKinds(next.doc), notebookEditorFormatRanges(next.doc));
        localDocument.current = useDocumentsStore.getState().documents.find(item => item.id === current.id) ?? null;
        if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
        const batchId = useHistoryStore.getState().batchId;
        typingTimer.current = window.setTimeout(() => {
          if (useHistoryStore.getState().batchId === batchId) endBatch();
          typingTimer.current = null;
        }, 900);
      },
    });
    view.current = editor;
    const previousPosition = notebookPositions.get(id);
    if (previousPosition && !createdFromEmpty.current) {
      const from = notebookEditorOffsetToPosition(editor.state.doc, previousPosition.from);
      const to = notebookEditorOffsetToPosition(editor.state.doc, previousPosition.to);
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)).scrollIntoView());
    }
    if (createdFromEmpty.current) {
      createdFromEmpty.current = false;
      requestAnimationFrame(() => {
        const end = editor.state.doc.content.size - 1;
        editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
        editor.focus();
      });
    } else if (notebook.id !== EMPTY_NOTEBOOK.id && notebook.revision === 1
      && !notebook.source && notebook.blocks.every(block => !block.text)) {
      editor.focus();
    }
    return () => {
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
      editor.destroy(); view.current = null; endBatch();
    };
    // A document switch creates a new runtime editor; revisions are synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook.id]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || localDocument.current === document) return;
    const nextDoc = createNotebookEditorDocument(notebook);
    if (editor.state.doc.eq(nextDoc)) return;
    const from = notebookEditorPositionToOffset(editor.state.doc, editor.state.selection.from);
    const to = notebookEditorPositionToOffset(editor.state.doc, editor.state.selection.to);
    const state = EditorState.create({ doc: nextDoc, plugins: editor.state.plugins });
    const start = notebookEditorOffsetToPosition(nextDoc, from);
    const end = notebookEditorOffsetToPosition(nextDoc, to);
    editor.updateState(state.apply(state.tr.setSelection(TextSelection.create(nextDoc, start, end))));
  }, [document, notebook]);

  useEffect(() => {
    queryRef.current = query;
    const editor = view.current;
    if (!editor) return;
    const found = searchOffsets(notebookEditorText(editor.state.doc), query);
    setMatches(found);
    setMatchIndex(0);
    editor.setProps({ decorations: state => {
      const decorations = searchOffsets(notebookEditorText(state.doc), query)
        .filter(([from, to]) => !notebookEditorText(state.doc).slice(from, to).includes('\u2029'))
        .map(([from, to]) => Decoration.inline(
          notebookEditorOffsetToPosition(state.doc, from), notebookEditorOffsetToPosition(state.doc, to),
          { class: 'notebook-search-hit' }));
      for (const scene of notebook.scenes ?? []) {
        const range = notebookAnchorOffsets(notebook.blocks, scene.anchor);
        if (range && range[0] < range[1] && scene.anchor.status === 'resolved') decorations.push(
          Decoration.inline(notebookEditorOffsetToPosition(state.doc, range[0]),
            notebookEditorOffsetToPosition(state.doc, range[1]), { class: 'notebook-scene-range' }));
      }
      for (const label of notebook.labels ?? []) {
        const range = notebookAnchorOffsets(notebook.blocks, label.anchor);
        if (range && range[0] < range[1] && label.anchor.status === 'resolved') decorations.push(
          Decoration.inline(notebookEditorOffsetToPosition(state.doc, range[0]),
            notebookEditorOffsetToPosition(state.doc, range[1]), { class: 'notebook-label-range',
              title: label.name }));
      }
      if (dropPreview) {
        const [from, to] = dropPreview;
        const position = notebookEditorOffsetToPosition(state.doc, from);
        if (from === to) decorations.push(Decoration.widget(position, () => {
          const marker = window.document.createElement('span');
          marker.className = 'notebook-drop-caret';
          return marker;
        }));
        else decorations.push(Decoration.inline(position,
          notebookEditorOffsetToPosition(state.doc, to), { class: 'notebook-drop-preview' }));
      }
      return DecorationSet.create(state.doc, decorations);
    } });
  }, [query, notebook, dropPreview]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !navigationRequest || navigationRequest.documentId !== notebook.id) return;
    const offset = notebookOffset(notebook.blocks, { blockId: navigationRequest.blockId, offset: 0 });
    if (offset === null) return;
    const position = notebookEditorOffsetToPosition(editor.state.doc, offset);
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)).scrollIntoView());
  }, [navigationRequest, notebook.id, notebook.blocks]);

  const command = (run: (view: EditorView) => void) => {
    const editor = view.current;
    if (!editor) return;
    run(editor);
    editor.focus();
  };
  const goToMatch = (direction: number) => {
    const editor = view.current;
    if (!editor || matches.length === 0) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    const [from, to] = matches[next];
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,
      notebookEditorOffsetToPosition(editor.state.doc, from),
      notebookEditorOffsetToPosition(editor.state.doc, to))).scrollIntoView());
    editor.focus();
    setMatchIndex(next);
  };
  const hasSelection = Boolean(view.current && !view.current.state.selection.empty);
  const captureAnchor = (purpose: 'scene' | 'word' | 'selection' = 'selection'): DocumentAnchor | null => {
    const editor = view.current;
    const current = useDocumentsStore.getState().documents.find(item => item.id === notebook.id);
    if (!editor || !current) return null;
    let start = notebookEditorPositionToOffset(editor.state.doc, editor.state.selection.from);
    let end = notebookEditorPositionToOffset(editor.state.doc, editor.state.selection.to);
    if (start === end && purpose !== 'selection') {
      const point = notebookPoint(current.blocks, start);
      const block = current.blocks.find(item => item.id === point.blockId);
      if (block) {
        if (purpose === 'scene') {
          start -= point.offset;
          end = start + block.text.length;
        } else {
          const before = block.text.slice(0, point.offset).match(/[\p{L}\p{N}_-]+$/u)?.[0].length ?? 0;
          const after = block.text.slice(point.offset).match(/^[\p{L}\p{N}_-]+/u)?.[0].length ?? 0;
          start -= before;
          end += after;
        }
      }
    }
    return notebookAnchor(current.blocks, start, end);
  };
  const previewSceneAtCursor = () => {
    if (!view.current?.state.selection.empty) return;
    const anchor = captureAnchor('scene');
    const range = anchor && notebookAnchorOffsets(notebook.blocks, anchor);
    setDropPreview(range);
  };
  const addScene = () => {
    setDropPreview(null);
    const anchor = captureAnchor('scene');
    if (!anchor) return;
    const candidate = notebookAnchorOffsets(notebook.blocks, anchor);
    if (!candidate) return;
    const overlaps = (notebook.scenes ?? []).some(scene => {
      const range = notebookAnchorOffsets(notebook.blocks, scene.anchor);
      return range && candidate[0] < range[1] && range[0] < candidate[1];
    });
    if (overlaps) {
      setNotice('This passage already belongs to a scene. Change its range in scene properties.');
      view.current?.focus();
      return;
    }
    endBatch();
    const batch = startBatch('Mark Notebook scene');
    useDocumentsStore.getState().addScene(notebook.id, anchor);
    if (batch.opened) endBatch();
    setNotice('Scene marked. Its details are optional.');
    view.current?.focus();
  };
  const changeSceneRange = (sceneId: string) => {
    if (!view.current || view.current.state.selection.empty) {
      setNotice('Select the new scene passage, then choose Change range.');
      return;
    }
    const anchor = captureAnchor('selection');
    const candidate = anchor && notebookAnchorOffsets(notebook.blocks, anchor);
    if (!candidate) return;
    const overlap = notebook.scenes?.some(scene => {
      if (scene.id === sceneId) return false;
      const range = notebookAnchorOffsets(notebook.blocks, scene.anchor);
      return range && candidate[0] < range[1] && range[0] < candidate[1];
    });
    if (overlap) { setNotice('Scene ranges cannot overlap.'); return; }
    endBatch();
    const batch = startBatch('Change Notebook scene range');
    useDocumentsStore.getState().updateScene(notebook.id, sceneId, { anchor });
    if (batch.opened) endBatch();
  };
  const continueOutsideScene = (sceneId: string) => {
    const scene = notebook.scenes?.find(item => item.id === sceneId);
    const range = scene && notebookAnchorOffsets(notebook.blocks, scene.anchor);
    if (!range) return;
    const end = notebookPoint(notebook.blocks, range[1]);
    endBatch();
    const batch = startBatch('Continue outside Notebook scene');
    useDocumentsStore.getState().replaceRange(notebook.id, end, end, '\u2029');
    const changed = useDocumentsStore.getState().documents.find(item => item.id === notebook.id);
    if (changed) useDocumentsStore.getState().updateScene(notebook.id, sceneId,
      { anchor: notebookAnchor(changed.blocks, range[0], range[1]) });
    if (batch.opened) endBatch();
    requestAnimationFrame(() => {
      const editor = view.current;
      if (!editor) return;
      const position = notebookEditorOffsetToPosition(editor.state.doc, range[1] + 1);
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)));
      editor.focus();
    });
  };
  const openComposer = (kind: 'label' | 'comment') => {
    const anchor = captureAnchor(kind === 'label' ? 'word' : 'selection');
    if (!anchor) return;
    setPendingAnchor(anchor);
    setComposerText('');
    setComposer(kind);
  };
  const saveComposer = () => {
    const text = composerText.trim();
    if (!pendingAnchor || !composer || !text) return;
    endBatch();
    const batch = startBatch(composer === 'label' ? 'Add Notebook label' : 'Add Notebook comment');
    if (composer === 'label') useDocumentsStore.getState().addLabel(notebook.id, pendingAnchor, text);
    else useDocumentsStore.getState().addComment(notebook.id, pendingAnchor, text);
    if (batch.opened) endBatch();
    setComposer(null);
    setPendingAnchor(null);
  };
  const addSourceLink = (mediaId: string) => {
    const anchor = captureAnchor('word');
    if (!anchor || !mediaId) return;
    endBatch();
    const batch = startBatch('Link Notebook passage to media');
    useDocumentsStore.getState().addLink(notebook.id, anchor, { kind: 'source', mediaId },
      media.find(item => item.id === mediaId)?.name);
    if (batch.opened) endBatch();
  };
  const addClipLink = () => {
    const anchor = captureAnchor('word');
    if (!anchor || !selectedClipId || !activeCompositionId) return;
    endBatch();
    const batch = startBatch('Link Notebook passage to clip');
    useDocumentsStore.getState().addLink(notebook.id, anchor,
      { kind: 'clip', compositionId: activeCompositionId, clipId: selectedClipId });
    if (batch.opened) endBatch();
  };
  const annotateClip = () => {
    const anchor = captureAnchor('selection');
    if (!anchor?.quote || !selectedClipId || !activeCompositionId) return;
    endBatch();
    linkDocumentPassageToClip({ documentId: notebook.id, documentRevision: notebook.revision,
      anchor }, activeCompositionId, selectedClipId);
  };
  const selectedEditor = view.current;
  const hasFloatingSelection = Boolean(selectedEditor && !selectedEditor.state.selection.empty);
  let floatingStyle: { left: number; top: number } | undefined;
  if (hasFloatingSelection && selectedEditor) {
    try {
      const rect = selectedEditor.coordsAtPos(selectedEditor.state.selection.from);
      floatingStyle = { left: Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - 310)),
        top: rect.top >= 52 ? rect.top - 45 : rect.bottom + 8 };
    } catch { /* Selection may be between rendered frames. */ }
  }
  void selectionVersion;
  return <div className="notebook-writing">
    {!focusWriting && floatingStyle && <div className="notebook-floating-actions" style={floatingStyle}
      role="toolbar" aria-label="Selection actions">
      <button type="button" aria-label="Bold selection" onMouseDown={event => event.preventDefault()}
        onClick={() => command(editor => { toggleMark(notebookEditorSchema.marks.bold)(editor.state, editor.dispatch, editor); })}>B</button>
      <button type="button" aria-label="Italic selection" onMouseDown={event => event.preventDefault()}
        onClick={() => command(editor => { toggleMark(notebookEditorSchema.marks.italic)(editor.state, editor.dispatch, editor); })}><em>I</em></button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => openComposer('label')}>Label</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={addScene}>Scene</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => openComposer('comment')}>Comment</button>
      <select aria-label="Link selected text to media" value="" onChange={event => addSourceLink(event.target.value)}>
        <option value="">Link…</option>
        {media.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>}
    {!focusWriting && <div className="notebook-format-toolbar" role="toolbar" aria-label="Text formatting">
      <select aria-label="Text format" value={blockKind}
        onChange={event => command(editor => { setBlockType(notebookEditorSchema.nodes.paragraph,
          { kind: event.target.value })(editor.state, editor.dispatch, editor); })}>
        {(notebook.kind === 'screenplay' ? SCRIPT_KINDS : TEXT_KINDS)
          .map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
      </select>
      <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" onMouseDown={event => event.preventDefault()}
        onClick={() => command(editor => { toggleMark(notebookEditorSchema.marks.bold)(editor.state, editor.dispatch, editor); })}>B</button>
      <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" onMouseDown={event => event.preventDefault()}
        onClick={() => command(editor => { toggleMark(notebookEditorSchema.marks.italic)(editor.state, editor.dispatch, editor); })}><em>I</em></button>
      <details className="notebook-add-menu">
        <summary>Add</summary>
        <div className="notebook-add-options">
      <button type="button" draggable onDragStart={event => {
        event.dataTransfer.setData('application/x-ms-notebook-scene', 'scene');
        event.dataTransfer.effectAllowed = 'copy';
      }} onDragEnd={() => view.current?.focus()}
        onPointerEnter={previewSceneAtCursor} onPointerLeave={() => setDropPreview(null)}
        onFocus={previewSceneAtCursor} onBlur={() => setDropPreview(null)}
        onClick={addScene}>Scene</button>
      <button type="button" draggable onDragStart={event => {
        event.dataTransfer.setData('application/x-ms-notebook-label', 'Label');
        event.dataTransfer.effectAllowed = 'copy';
      }} onDragEnd={() => view.current?.focus()} onClick={() => openComposer('label')}>Label</button>
      {[...new Set(notebook.labels?.map(label => label.name) ?? [])].map(name =>
        <button key={name} type="button" draggable
          onDragStart={event => {
            event.dataTransfer.setData('application/x-ms-notebook-label', name);
            event.dataTransfer.effectAllowed = 'copy';
          }} onDragEnd={() => view.current?.focus()}
          onClick={() => {
            const anchor = captureAnchor('word');
            if (!anchor) return;
            endBatch();
            const batch = startBatch('Add Notebook label');
            useDocumentsStore.getState().addLabel(notebook.id, anchor, name);
            if (batch.opened) endBatch();
            view.current?.focus();
          }}>
          {name}
        </button>)}
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => openComposer('comment')}>Comment</button>
      <select aria-label="Link passage to media" value="" onChange={event => addSourceLink(event.target.value)}>
        <option value="">Link media…</option>
        {media.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <button type="button" disabled={!selectedClipId || !activeCompositionId} onMouseDown={event => event.preventDefault()}
        onClick={addClipLink}>Link clip</button>
      <button type="button" disabled={!hasSelection || !selectedClipId || !activeCompositionId}
        onMouseDown={event => event.preventDefault()} onClick={annotateClip}>Annotate clip</button>
      <button type="button" disabled={!hasSelection} draggable={hasSelection} onDragStart={event => {
        const anchor = captureAnchor('selection');
        if (!anchor?.quote) { event.preventDefault(); return; }
        event.dataTransfer.setData(DOCUMENT_PASSAGE_MIME, JSON.stringify({
          documentId: notebook.id, documentRevision: notebook.revision, anchor }));
        event.dataTransfer.effectAllowed = 'link';
      }}>Drag passage to clip</button>
        </div>
      </details>
      <span className="notebook-selection-state">{hasSelection ? 'Selection ready' : ''}</span>
      {query.trim() && <span className="notebook-search-controls">
        {matches.length ? `${matchIndex + 1}/${matches.length}` : 'No matches'}
        <button type="button" aria-label="Previous match" disabled={!matches.length}
          onClick={() => goToMatch(-1)}>↑</button>
        <button type="button" aria-label="Next match" disabled={!matches.length}
          onClick={() => goToMatch(1)}>↓</button>
      </span>}
    </div>}
    {composer && <form className="notebook-composer" onSubmit={event => { event.preventDefault(); saveComposer(); }}>
      <input autoFocus aria-label={composer === 'label' ? 'Label name' : 'Comment text'}
        value={composerText} onChange={event => setComposerText(event.target.value)}
        placeholder={composer === 'label' ? 'Label name' : 'Write a comment'} />
      <button type="submit" disabled={!composerText.trim()}>Add</button>
      <button type="button" onClick={() => setComposer(null)}>Cancel</button>
    </form>}
    {notice && <p className="notebook-notice" role="status">{notice}</p>}
    <div ref={mount} className="notebook-editor-mount" />
    {!focusWriting && <NotebookDetails document={notebook} captureSelection={() => captureAnchor('selection')}
      changeSceneRange={changeSceneRange} continueOutsideScene={continueOutsideScene} notice={setNotice} />}
  </div>;
}
