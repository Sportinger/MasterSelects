export type DocumentKind = 'general' | 'screenplay';
export type DocumentBlockKind =
  | 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'table'
  | 'scene' | 'action' | 'character' | 'dialogue' | 'parenthetical'
  | 'transition' | 'dual-dialogue' | 'page-break';

export interface DocumentBlock {
  id: string;
  kind: DocumentBlockKind;
  text: string;
  sceneNumber?: string;
  omitted?: boolean;
  revisionId?: string;
  sourcePage?: number;
}

export interface DocumentAnchor {
  blockId: string;
  start: number;
  /** Absent in schema 1; the end then belongs to blockId. */
  endBlockId?: string;
  end: number;
  quote: string;
  status: 'resolved' | 'orphaned';
}

export interface NotebookLabel {
  id: string;
  name: string;
  color?: string;
  anchor: DocumentAnchor;
}

export interface NotebookScene {
  id: string;
  anchor: DocumentAnchor;
  name?: string;
  location?: string;
  interiorExterior?: 'interior' | 'exterior';
  timeOfDay?: string;
  labels?: string[];
  mediaIds?: string[];
}

export interface NotebookFormat {
  id: string;
  anchor: DocumentAnchor;
  kind: 'bold' | 'italic';
}

export type DocumentLinkTarget =
  | { kind: 'source'; mediaId: string; start?: number; end?: number }
  | { kind: 'clip'; compositionId: string; clipId: string; start?: number; end?: number }
  | { kind: 'composition'; compositionId: string; start: number; end: number }
  | { kind: 'source-annotation'; mediaId: string; annotationId: string }
  | { kind: 'composition-annotation'; compositionId: string; annotationId: string };

export interface DocumentLink {
  id: string;
  anchor: DocumentAnchor;
  target: DocumentLinkTarget;
  label?: string;
}

export interface DocumentComment {
  id: string;
  anchor: DocumentAnchor;
  text: string;
  createdAt: number;
}

export interface DocumentSource {
  fileName: string;
  mimeType: string;
  format: string;
  importedAt: number;
  byteLength: number;
  originalText?: string;
  originalData?: string;
  previewHtml?: string;
  fidelity: 'source' | 'approximate' | 'text-only';
  report?: string;
  pageCount?: number;
}

export interface ScreenplayLayout {
  pageSize: 'letter' | 'a4';
  titlePage?: { title: string; author: string; contact?: string };
  header?: string;
  footer?: string;
  sceneNumbers: boolean;
  lockedPages?: Record<string, string>;
  pageLocks?: Array<{ blockId: string; offset: number; label: string }>;
  scenesLocked?: boolean;
  revisions: Array<{ id: string; name: string; date: string; color: string }>;
  activeRevisionId?: string;
}

export interface ProjectDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  schemaVersion: 1 | 2;
  revision: number;
  createdAt: number;
  updatedAt: number;
  blocks: DocumentBlock[];
  links: DocumentLink[];
  comments: DocumentComment[];
  labels?: NotebookLabel[];
  scenes?: NotebookScene[];
  formats?: NotebookFormat[];
  source?: DocumentSource;
  screenplay?: ScreenplayLayout;
}

export interface DocumentsProjectState {
  schemaVersion: 1 | 2;
  documents: ProjectDocument[];
  activeDocumentId?: string | null;
}

export interface DocumentsProjectManifest {
  schemaVersion: 2 | 3;
  activeDocumentId?: string | null;
  artifacts: Array<{
    documentId: string;
    revision: number;
    fileName: string;
    digest: string;
    original?: { fileName: string; digest: string };
  }>;
}
