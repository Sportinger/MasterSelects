// 'keyframe' sheet: the selected clip's keyed properties, each with its keys (tap one to jump
// there), previous/next keyframe and deleting the key at the playhead per property. Select mode
// picks keys to copy or delete together; Paste puts copied keys at the playhead (the editor's
// copyKeyframes / pasteKeyframes, the same clipboard as the desktop keyframe lanes). Deletions and
// pastes show live inside one owned transaction: Done = one undo step; Cancel restores the keys and
// the playhead exactly as they were when the sheet opened.

import { useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { Keyframe } from '../../../types/keyframes';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { PhoneIcon } from '../shell/phoneIcons';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from '../text/phoneControls';
import { middleTruncate } from '../transition/phoneMiddleTruncate';
import { PhoneEmptyState } from '../transition/phoneSheetPrimitives';
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
  const session = usePhoneEditSession('Edit keyframes');
  const [opened] = useState(() => ({ target: resolvePhoneKeyframeTarget(), playhead: useTimelineStore.getState().playheadPosition }));
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [pastes, setPastes] = useState(0);
  const clipboardKeys = useTimelineStore((state) => state.clipboardKeyframes);
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
    if (!session.changed || !clipId) { session.cancel(); closeSheet(); return; }
    setBusy(true);
    const result = await session.commit(deleted.size > 0 ? () => removeKeys(clipId, deleted) : undefined);
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
  const deleteKey = (key: Keyframe) => deleteKeys([key.id]);
  const deleteKeys = (ids: readonly string[]) => {
    const nextDeleted = new Set([...deleted, ...ids]);
    setDeleted(nextDeleted);
    void session.apply(() => removeKeys(clip.id, nextDeleted));
  };
  const livePicked = keys.filter((key) => picked.has(key.id)).map((key) => key.id);
  const togglePick = (key: Keyframe) => {
    const next = new Set(picked);
    if (next.has(key.id)) next.delete(key.id); else next.add(key.id);
    setPicked(next);
  };
  const copyPicked = () => {
    if (livePicked.length === 0) {
      showUnavailable({ actionId: 'keyframe-copy', label: 'Copy keyframes', reason: 'Tap Select, then tap the keys to copy.' });
      return;
    }
    useTimelineStore.getState().copyKeyframes(livePicked);
    const copied = useTimelineStore.getState().clipboardKeyframes?.length ?? 0;
    showToast(copied > 0 ? `Copied ${copied} keyframe${copied === 1 ? '' : 's'}. Move the playhead (also on another clip) and tap Paste.` : 'These keys could not be copied.', copied > 0 ? 'info' : 'error');
  };
  const deletePicked = () => {
    if (livePicked.length === 0) {
      showUnavailable({ actionId: 'keyframe-delete-selected', label: 'Delete keyframes', reason: 'Tap Select, then tap the keys to delete.' });
      return;
    }
    deleteKeys(livePicked);
    setPicked(new Set());
  };
  const paste = () => {
    if (!clipboardKeys || clipboardKeys.length === 0) {
      showUnavailable({ actionId: 'keyframe-paste', label: 'Paste keyframes', reason: 'Nothing copied yet: tap Select, pick keys and tap Copy first.' });
      return;
    }
    if (local === null) {
      showUnavailable({ actionId: 'keyframe-paste', label: 'Paste keyframes', reason: 'Move the playhead onto this clip: the copied keys start at the playhead.' });
      return;
    }
    void session.apply(() => { useTimelineStore.getState().pasteKeyframes({ targetClipIds: [clip.id] }); }).then(() => setPastes((count) => count + 1));
  };

  const status = local === null
    ? 'The playhead is outside this clip.'
    : atPlayhead.length > 0
      ? `Playhead on a keyframe (${atPlayhead.length} propert${atPlayhead.length === 1 ? 'y' : 'ies'}).`
      : `Playhead at ${seconds(local)} in the clip, no keyframe here.`;

  return (
    <PhoneSheet title="Keyframes" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-keyframe-sheet">
        <p className="phone-keyframe-sheet__clip" title={clip.name}>{middleTruncate(clip.name, 40)}</p>
        <div className="phone-keyframe-sheet__nav">
          <button type="button" className="phone-keyframe-sheet__step" data-testid={IDS.prev} aria-disabled={previous === null}
            aria-label="Previous keyframe" onPointerUp={blurAfterPointer}
            onClick={() => (previous === null ? showToast('No earlier keyframe in this clip.') : jump(previous))}>
            <PhoneIcon name="back" size={22} />
          </button>
          <span className="phone-keyframe-sheet__status" data-testid={IDS.status} role="status">{status}</span>
          <button type="button" className="phone-keyframe-sheet__step phone-keyframe-sheet__step--next" data-testid={IDS.next} aria-disabled={next === null}
            aria-label="Next keyframe" onPointerUp={blurAfterPointer}
            onClick={() => (next === null ? showToast('No later keyframe in this clip.') : jump(next))}>
            <PhoneIcon name="back" size={22} />
          </button>
        </div>
        <div className="phone-keyframe-sheet__clipboard" role="group" aria-label="Keyframe clipboard">
          <button type="button" className="phone-design-chip" data-testid={IDS.selectMode} aria-pressed={selecting}
            onPointerUp={blurAfterPointer} onClick={() => { setSelecting(!selecting); if (selecting) setPicked(new Set()); }}>
            {selecting ? `Selected ${livePicked.length}` : 'Select'}
          </button>
          <button type="button" className="phone-design-chip" data-testid={IDS.copy} aria-disabled={livePicked.length === 0 || undefined}
            onPointerUp={blurAfterPointer} onClick={copyPicked}>
            Copy
          </button>
          <button type="button" className="phone-design-chip" data-testid={IDS.deleteSelected} aria-disabled={livePicked.length === 0 || undefined}
            onPointerUp={blurAfterPointer} onClick={deletePicked}>
            Delete
          </button>
          <button type="button" className="phone-design-chip" data-testid={IDS.paste}
            aria-disabled={!clipboardKeys?.length || local === null || undefined}
            onPointerUp={blurAfterPointer} onClick={paste}>
            Paste{clipboardKeys?.length ? ` ${clipboardKeys.length}` : ''}
          </button>
        </div>
        {groups.length === 0 && (
          <PhoneEmptyState icon="keyframe" testId={IDS.empty} title="No keyframes yet"
            body="Move the playhead and tap the diamond in the transport to key position, scale, rotation or opacity." />
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
                      aria-pressed={selecting ? picked.has(key.id) : here?.id === key.id} data-testid={IDS.key} data-time={key.time.toFixed(4)}
                      data-picked={picked.has(key.id) ? 'true' : undefined}
                      aria-label={`${group.label} keyframe at ${seconds(key.time)}${selecting ? (picked.has(key.id) ? ', selected' : ', not selected') : ''}`}
                      onPointerUp={blurAfterPointer} onClick={() => (selecting ? togglePick(key) : jump(key.time))}>
                      ◆ {seconds(key.time)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {deleted.size > 0 && <p className="phone-design-note">{deleted.size} keyframe{deleted.size === 1 ? '' : 's'} deleted. Done keeps it as one undo step; Cancel brings {deleted.size === 1 ? 'it' : 'them'} back.</p>}
        {pastes > 0 && <p className="phone-design-note" data-testid={IDS.pasted}>Keys pasted at the playhead. Done keeps the changes as one undo step; Cancel takes them back.</p>}
      </div>
    </PhoneSheet>
  );
};
