import { projectFileService } from '../projectFileService';
import type { DocumentsProjectManifest, DocumentsProjectState, ProjectDocument } from '../../types/documents';

function isManifest(value: DocumentsProjectState | DocumentsProjectManifest | undefined): value is DocumentsProjectManifest {
  return value?.schemaVersion === 2 || value?.schemaVersion === 3;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(output);
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function writeDocumentsManifest(
  state: DocumentsProjectState,
  previous: DocumentsProjectState | DocumentsProjectManifest | undefined,
): Promise<DocumentsProjectManifest> {
  const prior = isManifest(previous) ? previous.artifacts : [];
  const artifacts: DocumentsProjectManifest['artifacts'] = [];
  for (const document of state.documents) {
    const originalData = document.source?.originalData;
    const originalDigest = originalData ? await digest(originalData) : undefined;
    const priorOriginal = prior.find(item => item.documentId === document.id
      && item.original?.digest === originalDigest)?.original;
    let original = priorOriginal;
    if (originalData && !original) {
      original = { fileName: `${crypto.randomUUID()}.source`, digest: originalDigest! };
      if (!await projectFileService.writeFile('DOCUMENTS', original.fileName,
        new Blob([decodeBase64(originalData)], { type: document.source?.mimeType || 'application/octet-stream' }))) {
        throw new Error(`Could not save original file for "${document.title}". The previous project version is intact.`);
      }
    }
    const storedDocument: ProjectDocument = originalData && document.source
      ? { ...document, source: { ...document.source, originalData: undefined } } : document;
    const value = JSON.stringify(storedDocument);
    const hash = await digest(value);
    const unchanged = prior.find(item => item.documentId === document.id
      && item.revision === document.revision && item.digest === hash
      && item.original?.digest === original?.digest);
    if (unchanged) { artifacts.push(unchanged); continue; }
    const fileName = `${crypto.randomUUID()}.json`;
    if (!await projectFileService.writeFile('DOCUMENTS', fileName, value)) {
      throw new Error(`Could not save document "${document.title}". The previous project version is intact.`);
    }
    artifacts.push({ documentId: document.id, revision: document.revision, fileName, digest: hash, original });
  }
  return { schemaVersion: 3, artifacts, activeDocumentId: state.activeDocumentId };
}

function validDocument(value: unknown, id: string, revision: number): value is ProjectDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<ProjectDocument>;
  return (doc.schemaVersion === 1 || doc.schemaVersion === 2) && doc.id === id && doc.revision === revision
    && typeof doc.title === 'string' && Array.isArray(doc.blocks)
    && Array.isArray(doc.links) && Array.isArray(doc.comments);
}

export async function readDocumentsManifest(
  value: DocumentsProjectState | DocumentsProjectManifest | undefined,
): Promise<DocumentsProjectState | undefined> {
  if (!value) return undefined;
  if (!isManifest(value)) {
    if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
      throw new Error(`Unsupported Notebook schema ${String(value.schemaVersion)}.`);
    }
    return value;
  }
  const documents: ProjectDocument[] = [];
  for (const artifact of value.artifacts) {
    const file = await projectFileService.readFile('DOCUMENTS', artifact.fileName);
    if (!file) throw new Error(`Document artifact ${artifact.fileName} is missing from the project.`);
    const json = await file.text();
    if (await digest(json) !== artifact.digest) throw new Error(`Document artifact ${artifact.fileName} failed its integrity check.`);
    const document: unknown = JSON.parse(json);
    if (!validDocument(document, artifact.documentId, artifact.revision)) {
      throw new Error(`Document artifact ${artifact.fileName} has invalid content.`);
    }
    if (artifact.original && document.source) {
      const originalFile = await projectFileService.readFile('DOCUMENTS', artifact.original.fileName);
      if (!originalFile) throw new Error(`Original file ${artifact.original.fileName} is missing from the project.`);
      const originalData = encodeBase64(new Uint8Array(await originalFile.arrayBuffer()));
      if (await digest(originalData) !== artifact.original.digest) {
        throw new Error(`Original file ${artifact.original.fileName} failed its integrity check.`);
      }
      document.source = { ...document.source, originalData };
    }
    documents.push(document);
  }
  return { schemaVersion: 2, documents, activeDocumentId: value.activeDocumentId };
}
