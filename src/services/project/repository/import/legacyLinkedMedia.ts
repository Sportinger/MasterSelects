import type { ProjectFile, ProjectMediaSourceRoot } from '../../types/project.types';
import type { LegacySourceBundle } from './legacySource';

/** Legacy relative media paths; absolute/external source paths are not part of the old folder. */
export function legacyMediaProjectPath(media: ProjectFile['media'][number]): string | null {
  const path = media.projectPath ?? (media.sourcePath && !/^(?:[a-z]:|\/)/i.test(media.sourcePath) ? media.sourcePath : null);
  return path ? path.replaceAll('\\', '/') : null;
}

/**
 * Media files stay in the old project folder. Each linked item is bound to that folder as a media
 * source root, so the editor resolves it through the regular source-root reader and its checks.
 * Items that already name a source root keep it; items outside the old folder keep their resolver fields.
 */
export async function bindLegacyLinkedMedia(project: ProjectFile, source: Pick<LegacySourceBundle, 'linkedPath'>,
  root: ProjectMediaSourceRoot | undefined, signal?: AbortSignal): Promise<{ project: ProjectFile; linked: number }> {
  if (!root) return { project, linked: 0 };
  let linked = 0;
  const media = [] as ProjectFile['media'];
  for (const item of project.media) {
    signal?.throwIfAborted();
    const logical = item.sourceRootId ? null : legacyMediaProjectPath(item);
    const physical = logical ? await source.linkedPath(logical) : null;
    if (!physical) { media.push(item); continue; }
    linked++; media.push({ ...item, sourceRootId: root.id, sourceRelativePath: physical });
  }
  if (!linked) return { project, linked };
  const roots = (project.mediaSourceRoots ?? []).filter(entry => entry.id !== root.id);
  return { project: { ...project, media, mediaSourceRoots: [...roots, root] }, linked };
}
