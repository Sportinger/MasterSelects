import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  DocumentAnchor, DocumentBlock, DocumentBlockKind, DocumentComment,
  DocumentKind, DocumentLink, DocumentLinkTarget, DocumentsProjectState,
  DocumentSource, ProjectDocument, ScreenplayLayout,
} from '../types/documents';
import type { NotebookFormat, NotebookLabel, NotebookScene } from '../types/documents';
import { nextProductionSuffix, paginateScreenplay } from '../services/documents/screenplayLayout';
import { notebookAnchor, replaceNotebookText, type NotebookPoint } from '../services/documents/notebookRange';

const uid = () => crypto.randomUUID();

interface DocumentsState {
  documents: ProjectDocument[];
  activeDocumentId: string | null;
  navigationRequest: { id: number; documentId: string; blockId: string } | null;
  showAnchor: (documentId: string, blockId: string) => void;
  createDocument: (title: string, kind: DocumentKind) => string;
  importDocument: (title: string, kind: DocumentKind, blocks: DocumentBlock[], source: DocumentSource,
    id?: string, titlePage?: ScreenplayLayout['titlePage']) => string;
  selectDocument: (id: string | null) => void;
  renameDocument: (id: string, title: string) => void;
  setDocumentKind: (id: string, kind: DocumentKind) => void;
  deleteDocument: (id: string) => void;
  insertBlock: (id: string, afterBlockId: string | null, kind: DocumentBlockKind, text?: string) => string;
  updateBlock: (id: string, blockId: string, text: string) => void;
  replaceRange: (id: string, from: NotebookPoint, to: NotebookPoint, text: string) => void;
  applyEditorState: (id: string, from: NotebookPoint, to: NotebookPoint, text: string,
    kinds: DocumentBlockKind[], formats: Array<{ from: number; to: number; kind: NotebookFormat['kind'] }>) => void;
  addLabel: (id: string, anchor: DocumentAnchor, name: string, color?: string) => string;
  removeLabel: (id: string, labelId: string) => void;
  updateLabel: (id: string, labelId: string, changes: Partial<Pick<NotebookLabel, 'name' | 'color'>>) => void;
  addScene: (id: string, anchor: DocumentAnchor) => string;
  removeScene: (id: string, sceneId: string) => void;
  updateScene: (id: string, sceneId: string, changes: Partial<Pick<NotebookScene,
    'anchor' | 'name' | 'location' | 'interiorExterior' | 'timeOfDay' | 'labels' | 'mediaIds'>>) => void;
  addFormat: (id: string, anchor: DocumentAnchor, kind: NotebookFormat['kind']) => string;
  setBlockKind: (id: string, blockId: string, kind: DocumentBlockKind) => void;
  removeBlock: (id: string, blockId: string) => void;
  moveBlock: (id: string, blockId: string, afterBlockId: string | null) => void;
  copyBlock: (id: string, blockId: string) => string | null;
  setPageSize: (id: string, size: 'letter' | 'a4') => void;
  setScreenplayDetails: (id: string, details: Pick<ScreenplayLayout, 'titlePage' | 'header' | 'footer'>) => void;
  setActiveRevision: (id: string, revisionId: string | null) => void;
  lockProductionPages: (id: string) => void;
  lockSceneNumbers: (id: string) => void;
  addRevision: (id: string, name: string, color: string) => string;
  addComment: (id: string, anchor: DocumentAnchor, text: string) => string;
  addLink: (id: string, anchor: DocumentAnchor, target: DocumentLinkTarget, label?: string) => string;
  removeLink: (id: string, linkId: string) => void;
  updateLinkAnchor: (id: string, linkId: string, anchor: DocumentAnchor) => void;
  updateLinkTarget: (id: string, linkId: string, target: DocumentLinkTarget) => void;
  hydrate: (value: DocumentsProjectState | null | undefined) => void;
  serialize: () => DocumentsProjectState;
  snapshot: () => DocumentsProjectState;
  reset: () => void;
}

function mutateDocument(state: DocumentsState, id: string, update: (doc: ProjectDocument) => ProjectDocument) {
  return { documents: state.documents.map(doc => doc.id === id ? update(doc) : doc) };
}

function createDocumentsStore() {
  return create<DocumentsState>()(subscribeWithSelector((set, get) => ({
  documents: [],
  activeDocumentId: null,
  navigationRequest: null,
  showAnchor: (documentId, blockId) => set(state => ({ activeDocumentId: documentId,
    navigationRequest: { id: (state.navigationRequest?.id ?? 0) + 1, documentId, blockId } })),
  createDocument: (title, kind) => {
    const id = uid();
    const now = Date.now();
    const block: DocumentBlock = { id: uid(), kind: kind === 'screenplay' ? 'scene' : 'paragraph', text: '' };
    set(state => ({ documents: [...state.documents, {
      id, title: title.trim(), kind, schemaVersion: 2, revision: 1,
      createdAt: now, updatedAt: now, blocks: [block], links: [], comments: [], labels: [], scenes: [], formats: [],
      ...(kind === 'screenplay' ? { screenplay: { pageSize: 'letter' as const, sceneNumbers: true, revisions: [] } } : {}),
    }], activeDocumentId: id }));
    return id;
  },
  importDocument: (title, kind, blocks, source, requestedId, titlePage) => {
    const id = requestedId ?? uid();
    const now = Date.now();
    set(state => ({ documents: [...state.documents.filter(doc => doc.id !== id), {
      id, title, kind, schemaVersion: 2, revision: 1, createdAt: now, updatedAt: now,
      blocks, links: [], comments: [], labels: [], scenes: [], formats: [], source,
      ...(kind === 'screenplay' ? { screenplay: { pageSize: 'letter' as const, sceneNumbers: true,
        revisions: [], ...(titlePage ? { titlePage } : {}) } } : {}),
    }], activeDocumentId: id }));
    return id;
  },
  selectDocument: id => set({ activeDocumentId: id }),
  renameDocument: (id, title) => set(state => mutateDocument(state, id, doc => ({ ...doc, title,
    revision: doc.revision + 1, updatedAt: Date.now() }))),
  setDocumentKind: (id, kind) => set(state => mutateDocument(state, id, doc => doc.kind === kind ? doc : ({
    ...doc, kind, screenplay: kind === 'screenplay' ? doc.screenplay ?? {
      pageSize: 'letter', sceneNumbers: true, revisions: [],
    } : doc.screenplay,
    revision: doc.revision + 1, updatedAt: Date.now(),
  }))),
  deleteDocument: id => set(state => ({ documents: state.documents.filter(doc => doc.id !== id),
    activeDocumentId: state.activeDocumentId === id ? state.documents.find(doc => doc.id !== id)?.id ?? null : state.activeDocumentId })),
  insertBlock: (id, afterBlockId, kind, text = '') => {
    const block: DocumentBlock = { id: uid(), kind, text };
    set(state => mutateDocument(state, id, doc => {
      const index = afterBlockId ? doc.blocks.findIndex(item => item.id === afterBlockId) + 1 : 0;
      const blocks = [...doc.blocks];
      block.revisionId = doc.screenplay?.activeRevisionId;
      if (kind === 'scene' && doc.screenplay?.scenesLocked) {
        const prior = blocks.slice(0, index).toReversed().find(item => item.kind === 'scene');
        const number = prior?.sceneNumber ?? '0';
        const base = number.match(/^\d+/u)?.[0] ?? '0';
        const used = new Set(blocks.filter(item => item.kind === 'scene').map(item => item.sceneNumber));
        let suffix = 0;
        while (used.has(`${base}${nextProductionSuffix(suffix)}`)) suffix++;
        block.sceneNumber = `${base}${nextProductionSuffix(suffix)}`;
      }
      blocks.splice(index, 0, block);
      return { ...doc, blocks, revision: doc.revision + 1, updatedAt: Date.now() };
    }));
    return block.id;
  },
  updateBlock: (id, blockId, text) => set(state => mutateDocument(state, id, doc => {
    const previous = doc.blocks.find(block => block.id === blockId);
    if (!previous || previous.text === text) return doc;
    let prefix = 0;
    while (prefix < previous.text.length && prefix < text.length && previous.text[prefix] === text[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.text.length - prefix && suffix < text.length - prefix
      && previous.text[previous.text.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
    return replaceNotebookText(doc, { blockId, offset: prefix },
      { blockId, offset: previous.text.length - suffix }, text.slice(prefix, text.length - suffix));
  })),
  replaceRange: (id, from, to, text) => set(state => mutateDocument(state, id, doc =>
    replaceNotebookText(doc, from, to, text))),
  applyEditorState: (id, from, to, text, kinds, formats) => set(state => mutateDocument(state, id, doc => {
    const edited = replaceNotebookText(doc, from, to, text);
    const nextBlocks = edited.blocks.map((block, index) => ({ ...block, kind: kinds[index] ?? block.kind }));
    if (nextBlocks.length !== kinds.length) return edited;
    const nextFormats: NotebookFormat[] = formats.map(format => ({ id: uid(), kind: format.kind,
      anchor: notebookAnchor(nextBlocks, format.from, format.to) }));
    return { ...edited, schemaVersion: 2, blocks: nextBlocks, formats: nextFormats,
      revision: edited === doc ? doc.revision + 1 : edited.revision,
      updatedAt: Date.now() };
  })),
  addLabel: (id, anchor, name, color) => {
    const label: NotebookLabel = { id: uid(), anchor, name: name.trim(), color };
    set(state => mutateDocument(state, id, doc => ({ ...doc, schemaVersion: 2,
      labels: [...(doc.labels ?? []), label], revision: doc.revision + 1, updatedAt: Date.now() })));
    return label.id;
  },
  removeLabel: (id, labelId) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    labels: doc.labels?.filter(label => label.id !== labelId), revision: doc.revision + 1,
    updatedAt: Date.now() }))),
  updateLabel: (id, labelId, changes) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    labels: doc.labels?.map(label => label.id === labelId ? { ...label, ...changes } : label),
    revision: doc.revision + 1, updatedAt: Date.now() }))),
  addScene: (id, anchor) => {
    const scene: NotebookScene = { id: uid(), anchor };
    set(state => mutateDocument(state, id, doc => ({ ...doc, schemaVersion: 2,
      scenes: [...(doc.scenes ?? []), scene], revision: doc.revision + 1, updatedAt: Date.now() })));
    return scene.id;
  },
  removeScene: (id, sceneId) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    scenes: doc.scenes?.filter(scene => scene.id !== sceneId), revision: doc.revision + 1,
    updatedAt: Date.now() }))),
  updateScene: (id, sceneId, changes) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    scenes: doc.scenes?.map(scene => scene.id === sceneId ? { ...scene, ...changes } : scene),
    revision: doc.revision + 1, updatedAt: Date.now() }))),
  addFormat: (id, anchor, kind) => {
    const format: NotebookFormat = { id: uid(), anchor, kind };
    set(state => mutateDocument(state, id, doc => ({ ...doc, schemaVersion: 2,
      formats: [...(doc.formats ?? []), format], revision: doc.revision + 1, updatedAt: Date.now() })));
    return format.id;
  },
  setBlockKind: (id, blockId, kind) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    revision: doc.revision + 1, updatedAt: Date.now(),
    blocks: doc.blocks.map(block => block.id === blockId
      ? { ...block, kind, revisionId: doc.screenplay?.activeRevisionId ?? block.revisionId } : block) }))),
  removeBlock: (id, blockId) => set(state => mutateDocument(state, id, doc => {
    const index = doc.blocks.findIndex(block => block.id === blockId);
    if (index < 0) return doc;
    const block = doc.blocks[index];
    if (block.kind === 'scene' && doc.screenplay?.scenesLocked) {
      return { ...doc, revision: doc.revision + 1, updatedAt: Date.now(),
        blocks: doc.blocks.map(item => item.id === blockId ? { ...item, omitted: true, text: '' } : item) };
    }
    if (doc.blocks.length === 1) return replaceNotebookText(doc,
      { blockId, offset: 0 }, { blockId, offset: block.text.length }, '');
    if (index < doc.blocks.length - 1) return replaceNotebookText(doc,
      { blockId, offset: 0 }, { blockId: doc.blocks[index + 1].id, offset: 0 }, '');
    const previous = doc.blocks[index - 1];
    return replaceNotebookText(doc, { blockId: previous.id, offset: previous.text.length },
      { blockId, offset: block.text.length }, '');
  })),
  moveBlock: (id, blockId, afterBlockId) => set(state => mutateDocument(state, id, doc => {
    if (blockId === afterBlockId || !doc.blocks.some(block => block.id === blockId)) return doc;
    const blocks = doc.blocks.filter(block => block.id !== blockId);
    const index = afterBlockId ? blocks.findIndex(block => block.id === afterBlockId) + 1 : 0;
    const moved = doc.blocks.find(block => block.id === blockId)!;
    blocks.splice(Math.max(0, index), 0, moved);
    return { ...doc, blocks, revision: doc.revision + 1, updatedAt: Date.now() };
  })),
  copyBlock: (id, blockId) => {
    const source = get().documents.find(doc => doc.id === id)?.blocks.find(block => block.id === blockId);
    if (!source) return null;
    const copied: DocumentBlock = { ...source, id: uid() };
    set(state => mutateDocument(state, id, doc => {
      const index = doc.blocks.findIndex(block => block.id === blockId);
      const links = doc.links.filter(link => link.anchor.blockId === blockId).map(link => ({
        ...link, id: uid(), anchor: { ...link.anchor, blockId: copied.id },
      }));
      const comments = doc.comments.filter(comment => comment.anchor.blockId === blockId).map(comment => ({
        ...comment, id: uid(), anchor: { ...comment.anchor, blockId: copied.id },
      }));
      const copyAnchor = (anchor: DocumentAnchor) => ({ ...anchor, blockId: copied.id,
        ...(anchor.endBlockId ? { endBlockId: copied.id } : {}) });
      const labels = (doc.labels ?? []).filter(item => item.anchor.blockId === blockId
        && (!item.anchor.endBlockId || item.anchor.endBlockId === blockId))
        .map(item => ({ ...item, id: uid(), anchor: copyAnchor(item.anchor) }));
      const scenes = (doc.scenes ?? []).filter(item => item.anchor.blockId === blockId
        && (!item.anchor.endBlockId || item.anchor.endBlockId === blockId))
        .map(item => ({ ...item, id: uid(), anchor: copyAnchor(item.anchor) }));
      const formats = (doc.formats ?? []).filter(item => item.anchor.blockId === blockId
        && (!item.anchor.endBlockId || item.anchor.endBlockId === blockId))
        .map(item => ({ ...item, id: uid(), anchor: copyAnchor(item.anchor) }));
      const blocks = [...doc.blocks];
      blocks.splice(index + 1, 0, copied);
      return { ...doc, blocks, links: [...doc.links, ...links], comments: [...doc.comments, ...comments],
        labels: [...(doc.labels ?? []), ...labels], scenes: [...(doc.scenes ?? []), ...scenes],
        formats: [...(doc.formats ?? []), ...formats],
        revision: doc.revision + 1, updatedAt: Date.now() };
    }));
    return copied.id;
  },
  setPageSize: (id, size) => set(state => mutateDocument(state, id, doc => !doc.screenplay ? doc : ({
    ...doc, screenplay: { ...doc.screenplay, pageSize: size },
    revision: doc.revision + 1, updatedAt: Date.now(),
  }))),
  setScreenplayDetails: (id, details) => set(state => mutateDocument(state, id, doc => !doc.screenplay ? doc : ({
    ...doc, screenplay: { ...doc.screenplay, ...details }, revision: doc.revision + 1, updatedAt: Date.now(),
  }))),
  setActiveRevision: (id, revisionId) => set(state => mutateDocument(state, id, doc => !doc.screenplay
    || (revisionId && !doc.screenplay.revisions.some(item => item.id === revisionId)) ? doc : ({
      ...doc, screenplay: { ...doc.screenplay, activeRevisionId: revisionId ?? undefined },
      revision: doc.revision + 1, updatedAt: Date.now(),
    }))),
  lockProductionPages: id => set(state => mutateDocument(state, id, doc => {
    if (!doc.screenplay) return doc;
    const pageLocks = paginateScreenplay(doc)
      .filter(page => page.firstBlockId && page.firstLineOffset !== null)
      .map(page => ({ blockId: page.firstBlockId!, offset: page.firstLineOffset!, label: page.label }));
    return { ...doc, screenplay: { ...doc.screenplay, lockedPages: undefined, pageLocks },
      revision: doc.revision + 1, updatedAt: Date.now() };
  })),
  lockSceneNumbers: id => set(state => mutateDocument(state, id, doc => {
    if (!doc.screenplay) return doc;
    let number = 0;
    const blocks = doc.blocks.map(block => {
      if (block.kind !== 'scene') return block;
      number++;
      return { ...block, sceneNumber: block.sceneNumber ?? String(number) };
    });
    return { ...doc, blocks, screenplay: { ...doc.screenplay, scenesLocked: true },
      revision: doc.revision + 1, updatedAt: Date.now() };
  })),
  addRevision: (id, name, color) => {
    const revisionId = uid();
    set(state => mutateDocument(state, id, doc => !doc.screenplay ? doc : ({
      ...doc, screenplay: { ...doc.screenplay, revisions: [...doc.screenplay.revisions,
        { id: revisionId, name, color, date: new Date().toISOString().slice(0, 10) }],
        activeRevisionId: revisionId },
      revision: doc.revision + 1, updatedAt: Date.now(),
    })));
    return revisionId;
  },
  addComment: (id, anchor, text) => {
    const comment: DocumentComment = { id: uid(), anchor, text, createdAt: Date.now() };
    set(state => mutateDocument(state, id, doc => ({ ...doc, revision: doc.revision + 1,
      updatedAt: Date.now(), comments: [...doc.comments, comment] })));
    return comment.id;
  },
  addLink: (id, anchor, target, label) => {
    const link: DocumentLink = { id: uid(), anchor, target, label };
    set(state => mutateDocument(state, id, doc => ({ ...doc, revision: doc.revision + 1,
      updatedAt: Date.now(), links: [...doc.links, link] })));
    return link.id;
  },
  removeLink: (id, linkId) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    revision: doc.revision + 1, updatedAt: Date.now(), links: doc.links.filter(link => link.id !== linkId) }))),
  updateLinkAnchor: (id, linkId, anchor) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    revision: doc.revision + 1, updatedAt: Date.now(),
    links: doc.links.map(link => link.id === linkId ? { ...link, anchor } : link) }))),
  updateLinkTarget: (id, linkId, target) => set(state => mutateDocument(state, id, doc => ({ ...doc,
    revision: doc.revision + 1, updatedAt: Date.now(),
    links: doc.links.map(link => link.id === linkId ? { ...link, target } : link) }))),
  hydrate: value => set(state => {
    if (value && value.schemaVersion !== 1 && value.schemaVersion !== 2) {
      throw new Error(`Unsupported Notebook schema ${String(value.schemaVersion)}.`);
    }
    const documents = value?.documents.map(doc => {
      if (doc.schemaVersion !== 1 && doc.schemaVersion !== 2) {
        throw new Error(`Unsupported Notebook document schema ${String(doc.schemaVersion)}.`);
      }
      return { ...doc, schemaVersion: 2 as const, labels: doc.labels ?? [],
        scenes: doc.scenes ?? [], formats: doc.formats ?? [] };
    }) ?? [];
    return { documents,
      activeDocumentId: documents.some(doc => doc.id === value?.activeDocumentId)
        ? value!.activeDocumentId ?? null
        : documents.some(doc => doc.id === state.activeDocumentId)
          ? state.activeDocumentId : documents[0]?.id ?? null,
      navigationRequest: null };
  }),
  serialize: () => ({ schemaVersion: 2, documents: structuredClone(get().documents),
    activeDocumentId: get().activeDocumentId }),
  snapshot: () => ({ schemaVersion: 2, documents: get().documents,
    activeDocumentId: get().activeDocumentId }),
  reset: () => set({ documents: [], activeDocumentId: null, navigationRequest: null }),
  })));
}

type DocumentsStoreApi = ReturnType<typeof createDocumentsStore>;
const existingStore = import.meta.hot?.data?.documentsStore as DocumentsStoreApi | undefined;
export const useDocumentsStore = existingStore ?? createDocumentsStore();
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => { data.documentsStore = useDocumentsStore; });
}
