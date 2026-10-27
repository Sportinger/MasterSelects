// 'keyframe' sheet: the selected clip's keyed properties, each with its keys (tap one to jump
// there), previous/next keyframe and deleting the key at the playhead per property. Deletions show
// live inside one owned transaction: Done = one undo step; Cancel restores the keys and the
// playhead exactly as they were when the sheet opened.

import { useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { Keyframe } from '../../../types/keyframes';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { PhoneIcon } from '../shell/phoneIcons';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from '../text/phoneControls';
import {
  adjacentPhoneKeyTime, listPhoneKeyedProperties, phoneClipLocalTime, phoneKeysAt, resolvePhoneKeyframeTarget,
  PHONE_KEYFRAME_TIME_TOLERANCE,
} from './phoneKeyframeCommands';
import { PHONE_KEYFRAME_TEST_IDS as IDS } from './phoneKeyframeTestIds';
import './PhoneKeyframe.css';

const NO_KEYS: Keyframe[] = [];
const seconds = (time: number) => `${time.toFixed(2)} s`;

/** Removes every key of `ids` that still exists: an absolute write, safe to repeat. */
function removeKeys(clipId: string, ids: ReadonlySet<string>) {
  const keys = useTimelineStore.getState().clipKeyframes.get(clipId) ?? [];
  for (const key of keys) if (ids.has(key.id)) useTimelineStore.getState().removeKeyframe(key.id);
}

export const PhoneKeyframeSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneEditSession('Delete keyframes');
  const [opened] = useState(() => ({ target: resolvePhoneKeyframeTarget(), playhead: useTimelineStore.getState().playheadPosition }));
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const clipId = opened.target.ok ? opened.target.clip.id : null;
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === clipId));
  const keys = useTimelineStore((state) => (clipId ? state.clipKeyframes.get(clipId) ?? NO_KEYS : NO_KEYS));
  const playhead = useTimelineStore((state) => state.playheadPosition);

  const restorePlayhead = () => {
    if (Math.abs(useTimelineStore.getState().playheadPosition - opened.playhead) > 1e-9) useTimelineStore.getState().setPlayheadPosition(opened.playhead);
  };
  const cancel = () => {
    if (busy) return;
    session.cancel();
    restorePlayhead();
    closeSheet();
  };
  const done = async () => {
    if (busy) return;
    if (deleted.size === 0 || !clipId) { session.cancel(); closeSheet(); return; }
    setBusy(true);
    const result = await session.commit(() => removeKeys(clipId, deleted));
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  if (!opened.target.ok || !clip) {
    return (
      <PhoneSheet title="Keyframes" onCancel={cancel} cancelLabel="Close">
        <p className="phone-sheet__note" data-testid={IDS.empty}>{opened.target.ok ? 'The clip is gone.' : opened.target.reason}</p>
      </PhoneSheet>
    );
  }

  const local = phoneClipLocalTime(clip, playhead);
  const groups = listPhoneKeyedProperties(keys, clip);
  const atPlayhead = local === null ? [] : phoneKeysAt(keys, local);
  const previous = adjacentPhoneKeyTime(keys, local ?? playhead - clip.startTime, -1);
  const next = adjacentPhoneKeyTime(keys, local ?? playhead - clip.startTime, 1);
  const jump = (time: number) => useTimelineStore.getState().setPlayheadPosition(clip.startTime + time);
  const deleteKey = (key: Keyframe) => {
    const nextDeleted = new Set(deleted).add(key.id);
    setDeleted(nextDeleted);
    void session.apply(() => removeKeys(clip.id, nextDeleted));
  };

  const status = local === null
    ? 'The playhead is outside this clip.'
    : atPlayhead.length > 0
      ? `Playhead on a keyframe (${atPlayhead.length} propert${atPlayhead.length === 1 ? 'y' : 'ies'}).`
      : `Playhead at ${seconds(local)} in the clip, no keyframe here.`;

  return (
    <PhoneSheet title={`Keyframes · ${clip.name}`} onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-keyframe-sheet">
        <div className="phone-keyframe-sheet__nav">
          <button type="button" className="phone-design-chip" data-testid={IDS.prev} aria-disabled={previous === null}
            onPointerUp={blurAfterPointer}
            onClick={() => (previous === null ? showToast('No earlier keyframe in this clip.') : jump(previous))}>
            ◀ Previous
          </button>
          <span className="phone-keyframe-sheet__status" data-testid={IDS.status} role="status">{status}</span>
          <button type="button" className="phone-design-chip" data-testid={IDS.next} aria-disabled={next === null}
            onPointerUp={blurAfterPointer}
            onClick={() => (next === null ? showToast('No later keyframe in this clip.') : jump(next))}>
            Next ▶
          </button>
        </div>
        {groups.length === 0 && (
          <p className="phone-design-note" data-testid={IDS.empty}>
            No keyframes yet. Close this sheet, move the playhead and tap the diamond in the transport to key position, scale, rotation and opacity.
          </p>
        )}
        <ul className="phone-keyframe-sheet__list">
          {groups.map((group) => {
            const here = local === null ? undefined : group.keys.find((key) => Math.abs(key.time - local) < PHONE_KEYFRAME_TIME_TOLERANCE);
            return (
              <li key={group.property} className="phone-keyframe-sheet__row" data-testid={IDS.row} data-property={group.property}>
                <div className="phone-keyframe-sheet__row-head">
                  <span className="phone-keyframe-sheet__label">{group.label}</span>
                  <span className="phone-keyframe-sheet__count">{group.keys.length}</span>
                  <button type="button" className="phone-icon-button phone-keyframe-sheet__delete"
                    aria-label={`Delete ${group.label} keyframe at playhead`} aria-disabled={here ? undefined : 'true'}
                    data-testid={IDS.deleteKey} onPointerUp={blurAfterPointer}
                    onClick={() => {
                      if (here) { deleteKey(here); return; }
                      showUnavailable({ actionId: 'keyframe-delete', label: 'Delete keyframe', reason: `${group.label} has no keyframe at the playhead. Tap one of its keys to jump there first.` });
                    }}>
                    <PhoneIcon name="delete" size={20} />
                  </button>
                </div>
                <div className="phone-keyframe-sheet__keys">
                  {group.keys.map((key) => (
                    <button key={key.id} type="button" className="phone-keyframe-sheet__key"
                      aria-pressed={here?.id === key.id} data-testid={IDS.key} data-time={key.time.toFixed(4)}
                      aria-label={`${group.label} keyframe at ${seconds(key.time)}`}
                      onPointerUp={blurAfterPointer} onClick={() => jump(key.time)}>
                      ◆ {seconds(key.time)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {deleted.size > 0 && <p className="phone-design-note">{deleted.size} keyframe{deleted.size === 1 ? '' : 's'} deleted. Done keeps it as one undo step; Cancel brings {deleted.size === 1 ? 'it' : 'them'} back.</p>}
      </div>
    </PhoneSheet>
  );
};
