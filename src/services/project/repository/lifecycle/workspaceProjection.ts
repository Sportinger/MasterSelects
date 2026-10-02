import type { JsonValue } from '../contracts';
import { REPOSITORY_LIMITS, RepositoryError } from '../contracts';
import { canonicalBytes } from '../segments/canonical';
import type { RepositorySession } from '../RepositorySession';
export interface WorkspacePart { key: string; value: JsonValue; }
class MissingWorkspacePartError extends RepositoryError {}
/** Large workspace groups split without creating content/history revisions. */
export function splitProjectWorkspace(workspace: JsonValue): WorkspacePart[] {
  const parts: WorkspacePart[] = [];
  function split(value: JsonValue, pointer: string): JsonValue {
    if (value === null) return null;
    if (canonicalBytes(value).length <= REPOSITORY_LIMITS.recordBytes - 4096) {
      const key = 'project/part/' + encodeURIComponent(pointer || '/'); parts.push({ key, value }); return { $workspacePart: key };
    }
    if (!value || typeof value !== 'object') throw new RepositoryError('budget', 'Single workspace value exceeds view slot budget');
    if (Array.isArray(value)) return value.map((child, index) => split(child, pointer + '/' + index));
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, split(child, pointer + '/' + encodeURIComponent(key))]));
  }
  const shape = split(workspace, '');
  if (canonicalBytes(shape).length > REPOSITORY_LIMITS.recordBytes - 4096) throw new RepositoryError('budget', 'Workspace shape exceeds view slot budget');
  parts.push({ key: 'project', value: { $workspaceShape: shape } }); return parts;
}
export async function readProjectWorkspace(session: RepositorySession): Promise<JsonValue | null> {
  const root = await session.readView('project');
  if (!root || typeof root !== 'object' || Array.isArray(root) || !('$workspaceShape' in root)) return root;
  async function restore(value: JsonValue): Promise<JsonValue> {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Promise.all(value.map(restore));
    if (typeof value.$workspacePart === 'string') {
      const part = await session.readView(value.$workspacePart);
      if (part === null) throw new MissingWorkspacePartError('corrupt', `Required project workspace part is missing: ${value.$workspacePart}`);
      return part;
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) result[key] = await restore(child);
    return result;
  }
  try { return await restore(root.$workspaceShape); }
  catch (error) {
    if (!(error instanceof MissingWorkspacePartError)) throw error;
    // An interrupted older writer could publish the shape before its parts.
    // Keep current content/history and recover only the previous complete UI workspace.
    const previous = await session.readView('project', true);
    if (previous === null) throw error;
    return previous && typeof previous === 'object' && !Array.isArray(previous) && '$workspaceShape' in previous
      ? restore(previous.$workspaceShape) : previous;
  }
}
