import { canonicalProjectKeyframe } from '../../projectKeyframeCodec';
import type { ProjectFile } from '../../types/project.types';
import type { ProjectClip } from '../../types/composition.types';
import { RepositoryError } from '../contracts';

/** Older packages persisted runtime keyframes; canonical membership owns their clip ID. */
export function normalizeLegacyClipKeyframes(clip: ProjectClip): ProjectClip {
  let changed = false;
  const keyframes = clip.keyframes.map(frame => {
    const legacy = frame as typeof frame & { clipId?: unknown };
    if (!Object.hasOwn(legacy, 'clipId')) return frame;
    if (legacy.clipId !== clip.id) throw new RepositoryError('corrupt', 'Legacy keyframe belongs to a different clip');
    changed = true;
    // Every authored curve/link field survives. Unknown fields remain subject to strict DTO validation.
    return canonicalProjectKeyframe(legacy);
  });
  return changed ? { ...clip, keyframes } : clip;
}

/** Detached canonical conversion; original package bytes and source evidence are untouched. */
export function normalizeLegacyProjectForRepository(project: ProjectFile): ProjectFile {
  let changed = false;
  const compositions = project.compositions.map(composition => {
    const clips = composition.clips.map(normalizeLegacyClipKeyframes);
    if (clips.every((clip, index) => clip === composition.clips[index])) return composition;
    changed = true; return { ...composition, clips };
  });
  return changed ? { ...project, compositions } : project;
}
