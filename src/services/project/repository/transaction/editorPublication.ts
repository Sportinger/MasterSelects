import type { RepositoryProjection } from '../contracts';

export interface EditorContentPublication { generation: number; revisionId: string | null; blocked: boolean; }
interface PublicationRuntime { value: EditorContentPublication; listeners: Set<() => void>; }
const runtime: PublicationRuntime = import.meta.hot?.data?.editorContentPublication ?? {
  value: Object.freeze({ generation: 0, revisionId: null, blocked: false }), listeners: new Set(),
};
/** Non-React render/audio consumers must read this before obtaining store projections. */
export function readEditorContentPublication(): EditorContentPublication { return runtime.value; }
export function subscribeEditorContentPublication(listener: () => void): () => void {
  runtime.listeners.add(listener); return () => runtime.listeners.delete(listener);
}
export function blockEditorContentPublication(): void { update({ ...runtime.value, blocked: true }); }
export function publishEditorContentProjection(projection: Pick<RepositoryProjection, 'generation' | 'revisionId'>): void {
  update({ ...projection, blocked: false });
}
function update(value: EditorContentPublication): void {
  runtime.value = Object.freeze(value);
  for (const listener of runtime.listeners) listener();
}
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.editorContentPublication = runtime; });
  import.meta.hot.accept();
}
