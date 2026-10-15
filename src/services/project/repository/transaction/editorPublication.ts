import type { RepositoryProjection } from '../contracts';

export interface EditorContentPublication { generation: number; revisionId: string | null; blocked: boolean; }
interface PublicationRuntime { value: EditorContentPublication; listeners: Set<() => void>; holds?: Set<symbol>; }
const runtime: PublicationRuntime = import.meta.hot?.data?.editorContentPublication ?? {
  value: Object.freeze({ generation: 0, revisionId: null, blocked: false }), listeners: new Set(),
};
/** Non-React render/audio consumers must read this before obtaining store projections. */
export function readEditorContentPublication(): EditorContentPublication { return runtime.value; }
export function subscribeEditorContentPublication(listener: () => void): () => void {
  runtime.listeners.add(listener); return () => runtime.listeners.delete(listener);
}
export function blockEditorContentPublication(): void { update({ ...runtime.value, blocked: true }); }
/** Session handoff owns an outer barrier; nested projection installs cannot release it. */
export function holdEditorContentPublication(): () => void {
  const token = Symbol('publication hold');
  (runtime.holds ??= new Set()).add(token);
  blockEditorContentPublication();
  return () => {
    if (!runtime.holds?.delete(token)) return;
    if (!runtime.holds.size) update({ ...runtime.value, blocked: false });
  };
}
export function publishEditorContentProjection(projection: Pick<RepositoryProjection, 'generation' | 'revisionId'>): void {
  update({ generation: projection.generation, revisionId: projection.revisionId, blocked: Boolean(runtime.holds?.size) });
}
function update(value: EditorContentPublication): void {
  runtime.value = Object.freeze(value);
  for (const listener of runtime.listeners) listener();
}
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.editorContentPublication = runtime; });
  import.meta.hot.accept();
}
