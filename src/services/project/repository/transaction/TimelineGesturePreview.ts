import { entityKey } from '../domains/jsonBoundary';
import type { TimelineStore } from '../../../../stores/timeline/types';
import { TIMELINE_STORE_SESSION_KEYS } from '../../../../stores/timeline/timelineSessionKeys';
import type { TimelineClip } from '../../../../types/timeline';
import type { Keyframe } from '../../../../types/keyframes';
import type { ProjectTransactionCoordinator, TransactionToken } from './ProjectTransactionCoordinator';

interface OriginalClip { clip: TimelineClip; keys: Keyframe[] | undefined; }
interface Preview { token: TransactionToken; compositionId: string; originals: Map<string, OriginalClip>; }
/**
 * Why a write inside a gesture cannot stay a live preview. `structural` rejections (clip list changes, no
 * active composition, an aggregate that needs repair) are expected; any other rejection means a caller mixed
 * extra fields into a pointer sample and every later sample pays the full project encoding.
 */
export interface GesturePreviewRejection { reason: string; structural: boolean; }
const PREVIEW_CONTENT_KEYS = new Set<string>(['clips', 'clipKeyframes']);

/** Immutable runtime values only. No project encoding, snapshots or disk writes per pointer sample. */
export class TimelineGesturePreview {
  private previews = new Map<symbol, Preview>();

  stage(coordinator: ProjectTransactionCoordinator, token: TransactionToken, compositionId: string | null | undefined,
    before: TimelineStore, patch: Partial<TimelineStore>): true | GesturePreviewRejection {
    // Structural edits and other domains keep their normal transactional path.
    if (!compositionId) return { reason: 'no active composition', structural: true };
    const fields = Object.keys(patch);
    const content = fields.filter(key => PREVIEW_CONTENT_KEYS.has(key));
    if (!content.length) return { reason: 'the write changes no clips or keyframes', structural: true };
    const foreign = fields.filter(key => !PREVIEW_CONTENT_KEYS.has(key) && !TIMELINE_STORE_SESSION_KEYS.has(key as keyof TimelineStore));
    if (foreign.length) return { reason: `the write also sets ${foreign.join(', ')}`, structural: false };
    const clips = patch.clips ?? before.clips, keys = patch.clipKeyframes ?? before.clipKeyframes;
    if (clips.length !== before.clips.length || clips.some((clip, i) => clip.id !== before.clips[i]?.id)) {
      return { reason: 'the clip list changes (add, remove or reorder)', structural: true };
    }
    const changed = clips.filter((clip, i) => clip !== before.clips[i] || keys.get(clip.id) !== before.clipKeyframes.get(clip.id));
    if (!changed.length) return true;
    // Missing aggregates must go through normal validation/repair, never a silent preview-only edit.
    if (changed.some(clip => !coordinator.getEntities().has(entityKey('clip', compositionId, clip.id)))) {
      return { reason: 'a changed clip has no saved record yet', structural: true };
    }
    const prior = this.previews.get(token.owner);
    // The live values of another composition left the store with its switch; the caller settles that preview.
    if (prior && prior.compositionId !== compositionId) return { reason: `the gesture's preview belongs to composition ${prior.compositionId}`, structural: true };
    coordinator.assertMutable();
    // All domain writers reserve this same aggregate root, including edits to its structural blocks.
    for (const clip of changed) coordinator.touch(token, entityKey('clip', compositionId, clip.id));
    const preview = prior ?? { token, compositionId, originals: new Map<string, OriginalClip>() };
    for (const clip of changed) if (!preview.originals.has(clip.id)) {
      preview.originals.set(clip.id, { clip: before.clips.find(value => value.id === clip.id)!, keys: before.clipKeyframes.get(clip.id) });
    }
    this.previews.set(token.owner, preview);
    return true;
  }

  /** The composition whose timeline store holds this gesture's live preview, if it has one. */
  compositionOf(token: TransactionToken): string | undefined { return this.previews.get(token.owner)?.compositionId; }

  /** Tokens of every gesture that holds a live preview of `compositionId`. */
  tokensFor(compositionId: string): TransactionToken[] {
    return [...this.previews.values()].filter(preview => preview.compositionId === compositionId).map(preview => preview.token);
  }

  /**
   * Reconstruct only this gesture's baseline; unrelated concurrent edits keep their latest values. Null when
   * there is no preview, or when `current` is the store of another composition: a baseline built from the
   * wrong composition's clips would write them into it. The caller settles such a stale preview.
   */
  baseline(token: TransactionToken, current: TimelineStore, compositionId: string | null | undefined): TimelineStore | null {
    const preview = this.previews.get(token.owner);
    if (!preview || preview.compositionId !== compositionId) return null;
    const clipKeyframes = new Map(current.clipKeyframes);
    for (const [id, original] of preview.originals) {
      if (original.keys) clipKeyframes.set(id, original.keys); else clipKeyframes.delete(id);
    }
    return { ...current, clips: current.clips.map(clip => preview.originals.get(clip.id)?.clip ?? clip), clipKeyframes };
  }

  delete(token: TransactionToken): void { this.previews.delete(token.owner); }
}
