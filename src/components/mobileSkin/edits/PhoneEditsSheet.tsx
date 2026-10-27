// 'edits' sheet (clip): the pro trim modes for the selected clip. Ripple trims the start or end to
// the playhead and closes the gap; Roll moves a cut together with the neighbour; Slip shows other
// footage at the same place; Slide moves the clip between its neighbours keeping their outer cuts;
// Gaps closes every gap on the track; Link joins or separates audio and video. Steps are frames of
// the composition. Everything runs through the editor's own edit operations inside ONE owned edit
// session: Done keeps all of it as one undo step, Cancel rolls it back exactly.

import { useRef, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import { PHONE_FULL_EDITOR_HINT, type PhoneActionResult, type PhoneSheetComponent } from '../contracts';
import { ProButton, ProMessage, ProStepper } from '../compositions/phoneProControls';
import { formatPhoneMarkerTime } from '../markers/phoneMarkerFormat';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneChoice, PhoneGreyedOption, PhoneTabs } from '../transition/phoneChoiceControls';
import {
  phoneCloseTrackGaps, phoneLink, phoneRippleTrim, phoneRollTo, phoneSlideTo, phoneSlipTo, phoneUnlink, type PhoneOffsetResult,
} from './phoneTrimCommands';
import { PHONE_EDITS_TEST_IDS as IDS } from './phoneEditsTestIds';
import { formatPhoneFrames, phoneRippleTrimReason, phoneSlideRange, phoneSlipRange, phoneTrimNeighbours } from './phoneTrimPlans';
import './PhoneEditsSheet.css';

type Bases = { rollStart?: number; rollEnd?: number; slip?: number; slide?: number };
type Mode = 'ripple' | 'roll' | 'slip' | 'slide' | 'gaps' | 'link';
const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'ripple', label: 'Ripple' }, { id: 'roll', label: 'Roll' }, { id: 'slip', label: 'Slip' },
  { id: 'slide', label: 'Slide' }, { id: 'gaps', label: 'Gaps' }, { id: 'link', label: 'Link' },
];
const STEPS = [{ label: '−10', delta: -10 }, { label: '−1', delta: -1 }, { label: '+1', delta: 1 }, { label: '+10', delta: 10 }];
const SYNC_REASON = `Lining clips up by their sound is not on the phone yet. ${PHONE_FULL_EDITOR_HINT}`;
const RANGE_REASON = `Lift and extract an in/out range arrive with the range tools; until then use Split and Delete + close gap. ${PHONE_FULL_EDITOR_HINT}`;

function initialClipId(): string | null {
  const timeline = useTimelineStore.getState();
  const primary = timeline.primarySelectedClipId;
  if (primary && timeline.selectedClipIds.has(primary)) return primary;
  return timeline.clips.find((clip) => timeline.selectedClipIds.has(clip.id))?.id ?? null;
}

export const PhoneEditsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Trim modes');
  const [clipId] = useState(initialClipId);
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const [mode, setMode] = useState<Mode>('ripple');
  const [rollSide, setRollSide] = useState<'start' | 'end'>('end');
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  // Baselines (seconds) captured when a stepper is first used: the steppers set absolute offsets from them.
  const basesRef = useRef<Bases>({});
  const [bases, setBases] = useState<Bases>({});
  const fps = getActiveCompositionFrameRate();
  const clip = clipId ? clips.find((candidate) => candidate.id === clipId) ?? null : null;

  const report = (result: PhoneActionResult, success?: string) => {
    setMessage(result.ok ? (result.message || success ? { text: result.message ?? success!, tone: 'info' } : null) : { text: result.message, tone: 'error' });
  };

  const run = (edit: () => PhoneActionResult, success?: string) => {
    void session.apply(() => report(edit(), success));
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  if (!clip) {
    return (
      <PhoneSheet title="Trim modes" onCancel={cancel} onDone={() => undefined} doneDisabled>
        <p className="phone-edits__empty" data-testid={IDS.empty}>Select a clip first, then open Trim modes.</p>
      </PhoneSheet>
    );
  }

  const track = tracks.find((candidate) => candidate.id === clip.trackId);
  const neighbours = phoneTrimNeighbours(clips, clip);
  const end = clip.startTime + clip.duration;
  const lockedReason = track?.locked ? 'The track is locked. Unlock it in Tracks first.' : null;

  /** One stepper press: read the current offset, add `deltaFrames`, set the new absolute offset. */
  const step = (key: 'rollStart' | 'rollEnd' | 'slip' | 'slide', deltaFrames: number | 'reset') => {
    void session.apply(() => {
      const live = useTimelineStore.getState().clips.find((candidate) => candidate.id === clip.id);
      if (!live) { report({ ok: false, message: 'The clip no longer exists.' }); return; }
      const current = key === 'slip' ? live.inPoint : key === 'slide' ? live.startTime : key === 'rollStart' ? live.startTime : live.startTime + live.duration;
      const base = basesRef.current[key] ?? current;
      if (basesRef.current[key] === undefined) {
        basesRef.current = { ...basesRef.current, [key]: base };
        setBases(basesRef.current);
      }
      const currentFrames = Math.round((current - base) * fps);
      const targetFrames = deltaFrames === 'reset' ? 0 : currentFrames + deltaFrames;
      const offset = targetFrames / fps;
      let outcome: PhoneOffsetResult;
      if (key === 'slip') outcome = phoneSlipTo(clip.id, base, offset);
      else if (key === 'slide') outcome = phoneSlideTo(clip.id, base, offset);
      else outcome = phoneRollTo(clip.id, key === 'rollStart' ? 'start' : 'end', base, offset);
      if (!outcome.result.ok) { report(outcome.result); return; }
      report(outcome.clamped ? { ok: true, message: 'No more room in that direction: the edit stops at the limit.' } : outcome.result);
    });
  };

  const offsetLabel = (key: 'rollStart' | 'rollEnd' | 'slip' | 'slide', current: number) => {
    const base = bases[key];
    return formatPhoneFrames(base === undefined ? 0 : Math.round((current - base) * fps));
  };

  const rippleReason = lockedReason ?? phoneRippleTrimReason(clip, playhead);
  const slipRange = phoneSlipRange(clip);
  const slipReason = lockedReason ?? (slipRange.max - slipRange.min < 1 / fps / 2 ? 'This clip shows all of its footage: trim it shorter first, then slip.' : null);
  const slideReason = lockedReason ?? (phoneSlideRange(neighbours) ? null : 'Slide needs a clip touching each side of this one.');
  const rollNeighbour = rollSide === 'start' ? neighbours.previous : neighbours.next;
  const rollReason = lockedReason ?? (rollNeighbour ? null : `No clip touches this clip's ${rollSide}. Pick the other cut or move the clips together.`);
  const linked = Boolean(clip.linkedClipId || clip.linkedGroupId);
  const selectedIds = clips.filter((candidate) => selectedClipIds.has(candidate.id)).map((candidate) => candidate.id);

  return (
    <PhoneSheet title="Trim modes" onCancel={cancel} onDone={() => void done()} doneDisabled={busy}>
      <div className="phone-edits">
        <p className="phone-edits__status" data-testid={IDS.status}>
          {clip.name} · {formatPhoneMarkerTime(clip.startTime, fps)}–{formatPhoneMarkerTime(end, fps)}{track ? ` · ${track.name}` : ''}
        </p>
        <PhoneTabs
          label="Trim mode"
          active={mode}
          tabs={MODES.map((entry) => ({ ...entry, testId: `${IDS.tab}-${entry.id}` }))}
          onSelect={(next) => { setMode(next); setMessage(null); }}
        />
        {mode === 'ripple' ? (
          <div className="phone-edits__panel">
            <p className="phone-edits__hint">Cut the clip at the playhead; later clips move up to close the gap.</p>
            <div className="phone-edits__row">
              <ProButton label="Trim start here" testId={IDS.rippleStart} unavailableReason={rippleReason} onPress={() => run(() => phoneRippleTrim(clip.id, 'start'), 'Start trimmed; the gap is closed.')} />
              <ProButton label="Trim end here" testId={IDS.rippleEnd} unavailableReason={rippleReason} onPress={() => run(() => phoneRippleTrim(clip.id, 'end'), 'End trimmed; the gap is closed.')} />
            </div>
          </div>
        ) : null}
        {mode === 'roll' ? (
          <div className="phone-edits__panel">
            <p className="phone-edits__hint">Move a cut: this clip and its neighbour change length together, nothing else moves.</p>
            <div className="phone-pro-chips" role="group" aria-label="Which cut">
              <PhoneChoice label="Cut at start" selected={rollSide === 'start'} testId={`${IDS.rollSide}-start`} onSelect={() => setRollSide('start')} />
              <PhoneChoice label="Cut at end" selected={rollSide === 'end'} testId={`${IDS.rollSide}-end`} onSelect={() => setRollSide('end')} />
            </div>
            <ProStepper
              label="Cut (frames)"
              value={rollSide === 'start' ? offsetLabel('rollStart', clip.startTime) : offsetLabel('rollEnd', end)}
              steps={STEPS}
              testId={IDS.roll}
              unavailableReason={rollReason}
              onStep={(delta) => step(rollSide === 'start' ? 'rollStart' : 'rollEnd', delta)}
              onReset={() => step(rollSide === 'start' ? 'rollStart' : 'rollEnd', 'reset')}
            />
          </div>
        ) : null}
        {mode === 'slip' ? (
          <div className="phone-edits__panel">
            <p className="phone-edits__hint">Show earlier or later footage; the clip keeps its place and length.</p>
            <ProStepper label="Footage (frames)" value={offsetLabel('slip', clip.inPoint)} steps={STEPS} testId={IDS.slip} unavailableReason={slipReason} onStep={(delta) => step('slip', delta)} onReset={() => step('slip', 'reset')} />
            <p className="phone-edits__hint">Room: {Math.round(-slipRange.min * fps)} f earlier, {Math.round(slipRange.max * fps)} f later.</p>
          </div>
        ) : null}
        {mode === 'slide' ? (
          <div className="phone-edits__panel">
            <p className="phone-edits__hint">Move the clip between its neighbours; they shorten or lengthen to fill.</p>
            <ProStepper label="Position (frames)" value={offsetLabel('slide', clip.startTime)} steps={STEPS} testId={IDS.slide} unavailableReason={slideReason} onStep={(delta) => step('slide', delta)} onReset={() => step('slide', 'reset')} />
          </div>
        ) : null}
        {mode === 'gaps' ? (
          <div className="phone-edits__panel">
            <p className="phone-edits__hint">Pull every clip on {track?.name ?? 'this track'} together so no empty space is left.</p>
            <ProButton label="Close gaps on this track" testId={IDS.closeGaps} unavailableReason={lockedReason} onPress={() => run(() => phoneCloseTrackGaps(clip.id), 'Gaps closed.')} />
            <PhoneGreyedOption label="Lift / extract a range" reason={RANGE_REASON} testId={IDS.rangeEdits} />
          </div>
        ) : null}
        {mode === 'link' ? (
          <div className="phone-edits__panel">
            <p className="phone-edits__hint">{linked ? 'This clip moves and trims together with its partner.' : 'Linked clips move and trim together (picture and its sound).'}</p>
            {linked ? (
              <ProButton label="Unlink audio and video" testId={IDS.unlink} unavailableReason={lockedReason} onPress={() => run(() => phoneUnlink(clip.id), 'Unlinked.')} />
            ) : (
              <ProButton label={selectedIds.length > 1 ? `Link ${selectedIds.length} selected clips` : 'Link with overlapping clip'} testId={IDS.link} unavailableReason={lockedReason} onPress={() => run(() => phoneLink(clip.id, selectedIds), 'Linked.')} />
            )}
            <PhoneGreyedOption label="Sync by audio" reason={SYNC_REASON} testId={IDS.audioSync} />
          </div>
        ) : null}
        <ProMessage text={message?.text ?? null} tone={message?.tone ?? 'info'} testId={IDS.message} />
      </div>
    </PhoneSheet>
  );
};
