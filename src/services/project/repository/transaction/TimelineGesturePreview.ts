import { RepositoryError } from '../contracts';
import { entityKey } from '../domains/jsonBoundary';
import type { TimelineStore } from '../../../../stores/timeline/types';
import type { TimelineClip } from '../../../../types/timeline';
import type { Keyframe } from '../../../../types/keyframes';
import type { ProjectTransactionCoordinator, TransactionToken } from './ProjectTransactionCoordinator';

interface OriginalClip { clip: TimelineClip; keys: Keyframe[] | undefined; }
interface Preview { compositionId: string; originals: Map<string, OriginalClip>; }

/** Immutable runtime values only. No project encoding, snapshots or disk writes per pointer sample. */
export class TimelineGesturePreview {
  private previews = new Map<symbol, Preview>();

  stage(coordinator: ProjectTransactionCoordinator, token: TransactionToken, compositionId: string | null | undefined,
    before: TimelineStore, patch: Partial<TimelineStore>): boolean {
    // Structural edits and other domains keep their normal transactional path.
    const fields = Object.keys(patch);
    if (!compositionId || !fields.length || fields.some(key => key !== 'clips' && key !== 'clipKeyframes')) return false;
    const clips = patch.clips ?? before.clips, keys = patch.clipKeyframes ?? before.clipKeyframes;
    if (clips.length !== before.clips.length || clips.some((clip, i) => clip.id !== before.clips[i]?.id)) return false;
    const changed = clips.filter((clip, i) => clip !== before.clips[i] || keys.get(clip.id) !== before.clipKeyframes.get(clip.id));
    if (!changed.length) return true;
    // Missing aggregates must go through normal validation/repair, never a silent preview-only edit.
    if (changed.some(clip => !coordinator.getEntities().has(entityKey('clip', compositionId, clip.id)))) return false;
    const prior = this.previews.get(token.owner);
    if (prior && prior.compositionId !== compositionId) throw new RepositoryError('ownership', 'Finish the drag before changing compositions');
    coordinator.assertMutable();
    // All domain writers reserve this same aggregate root, including edits to its structural blocks.
    for (const clip of changed) coordinator.touch(token, entityKey('clip', compositionId, clip.id));
    const preview = prior ?? { compositionId, originals: new Map<string, OriginalClip>() };
    for (const clip of changed) if (!preview.originals.has(clip.id)) {
      preview.originals.set(clip.id, { clip: before.clips.find(value => value.id === clip.id)!, keys: before.clipKeyframes.get(clip.id) });
    }
    this.previews.set(token.owner, preview);
    return true;
  }

  /** Reconstruct only this gesture's baseline; unrelated concurrent edits keep their latest values. */
  baseline(token: TransactionToken, current: TimelineStore, compositionId: string | null | undefined): TimelineStore | null {
    const preview = this.previews.get(token.owner);
    if (!preview) return null;
    if (preview.compositionId !== compositionId) throw new RepositoryError('ownership', 'Drag belongs to another composition');
    const clipKeyframes = new Map(current.clipKeyframes);
    for (const [id, original] of preview.originals) {
      if (original.keys) clipKeyframes.set(id, original.keys); else clipKeyframes.delete(id);
    }
    return { ...current, clips: current.clips.map(clip => preview.originals.get(clip.id)?.clip ?? clip), clipKeyframes };
  }

  delete(token: TransactionToken): void { this.previews.delete(token.owner); }
}
