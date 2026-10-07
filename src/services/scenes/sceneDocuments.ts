import { useDocumentsStore } from '../../stores/documentsStore';
import type { DocumentBlock, ProjectDocument } from '../../types/documents';

/**
 * Scenes live in project documents titled "Scene: <name>": a code block with the scene's
 * ms-scene-v1 text and a code block with the registry of what its last run created. Both are
 * plain project data, so scenes save, load and travel with the project like any document.
 */
export interface SceneEntities { tracks: string[]; clips: string[]; markers: string[] }
export interface SceneRegistryEntry extends SceneEntities { ref: string; tool: string }
export interface SceneRegistry {
  msSceneRegistry: 1;
  scene: string;
  compositionId: string | null;
  updatedAt: number;
  entries: SceneRegistryEntry[];
}

export const SCENE_DOCUMENT_PREFIX = 'Scene: ';
const STREAM_FENCE = '```ms-scene-v1';

export function sceneDocumentTitle(scene: string): string {
  return `${SCENE_DOCUMENT_PREFIX}${scene}`;
}

function parseRegistry(text: string): SceneRegistry | null {
  try {
    const value = JSON.parse(text) as SceneRegistry;
    return value && value.msSceneRegistry === 1 && Array.isArray(value.entries) ? value : null;
  } catch {
    return null;
  }
}

function sceneBlocks(doc: ProjectDocument): { stream?: DocumentBlock; registry?: DocumentBlock } {
  const code = doc.blocks.filter(block => block.kind === 'code');
  return {
    stream: code.find(block => block.text.trimStart().startsWith(STREAM_FENCE)),
    registry: code.find(block => parseRegistry(block.text) !== null),
  };
}

export function findSceneDocument(scene: string): ProjectDocument | undefined {
  const title = sceneDocumentTitle(scene);
  return useDocumentsStore.getState().documents.find(doc => doc.title === title && sceneBlocks(doc).stream);
}

export function loadSceneRegistry(scene: string): SceneRegistry | null {
  const doc = findSceneDocument(scene);
  const block = doc && sceneBlocks(doc).registry;
  return block ? parseRegistry(block.text) : null;
}

export function readSceneStream(scene: string): string | null {
  const doc = findSceneDocument(scene);
  return doc ? sceneBlocks(doc).stream?.text ?? null : null;
}

export function listScenes(): Array<{ scene: string; documentId: string; compositionId: string | null; clips: number; tracks: number }> {
  return useDocumentsStore.getState().documents.flatMap(doc => {
    if (!doc.title.startsWith(SCENE_DOCUMENT_PREFIX) || !sceneBlocks(doc).stream) return [];
    const registry = loadSceneRegistry(doc.title.slice(SCENE_DOCUMENT_PREFIX.length));
    return [{ scene: doc.title.slice(SCENE_DOCUMENT_PREFIX.length), documentId: doc.id, compositionId: registry?.compositionId ?? null,
      clips: registry?.entries.reduce((sum, entry) => sum + entry.clips.length, 0) ?? 0,
      tracks: registry?.entries.reduce((sum, entry) => sum + entry.tracks.length, 0) ?? 0 }];
  });
}

/** Store (or update in place) a scene's text and registry. Keeps the user's active document. */
export function saveScene(scene: string, streamText: string, registry: SceneRegistry): string {
  const store = useDocumentsStore.getState();
  const registryText = JSON.stringify(registry, null, 1);
  const existing = findSceneDocument(scene);
  if (existing) {
    const blocks = sceneBlocks(existing);
    if (blocks.stream) store.updateBlock(existing.id, blocks.stream.id, streamText);
    if (blocks.registry) store.updateBlock(existing.id, blocks.registry.id, registryText);
    else store.insertBlock(existing.id, blocks.stream?.id ?? null, 'code', registryText);
    return existing.id;
  }
  const previousActive = store.activeDocumentId;
  const id = store.createDocument(sceneDocumentTitle(scene), 'general');
  const intro = useDocumentsStore.getState().documents.find(doc => doc.id === id)!.blocks[0];
  store.updateBlock(id, intro.id, 'Scene stream (ms-scene-v1). Edit the stream block and run it again with runEditorStream { scene } to rebuild everything this scene created. The last block records what the last run created.');
  const streamBlock = store.insertBlock(id, intro.id, 'code', streamText);
  store.insertBlock(id, streamBlock, 'code', registryText);
  // Creating a document selects it; a background save must not switch the user's document.
  useDocumentsStore.getState().selectDocument(previousActive);
  return id;
}
