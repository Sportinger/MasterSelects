// 'transition' sheet: the transition at one cut. Opened from a cut button on the timeline (which
// targets that cut) or from the Transition tool of a selected clip (the cut after it, else before
// it). The sheet moves the playhead to the cut so the preview shows the middle of the transition;
// every choice applies live inside one owned edit session (phoneEditSession): Done keeps it as ONE
// undo step, Cancel rolls everything back and returns the playhead. "Apply to all cuts" extends
// the same choice to every cut on the track, still one undo step. Transition settings and offset
// stay visible but greyed until the pro sheets.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { TransitionCategory } from '../../../transitions';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneChoice, PhoneGreyedOption, blurAfterPointer } from './phoneChoiceControls';
import {
  applyPhoneTransition, phoneTransitionCatalog, phoneTransitionScopeCuts, phoneTransitionTiming,
  phoneTransitionUnavailableReason, type PhoneTransitionChoice, type PhoneTransitionDesired,
} from './phoneTransitionCommands';
import { phoneCutForClip, resolvePhoneCut, type PhoneCut, type PhoneCutTarget } from './phoneTransitionCuts';
import {
  PHONE_TRANSITION_TEST_IDS as IDS, phoneTransitionCategoryTestId, phoneTransitionChoiceTestId,
} from './phoneTransitionTestIds';
import { usePhoneTransitionTargetStore } from './phoneTransitionTargetStore';
import './PhoneTransitionSheet.css';

export const PHONE_TRANSITION_MIN_DURATION = 0.1;
export const PHONE_TRANSITION_MAX_DURATION = 5;
const DEFAULT_DURATION = 1;
const SETTINGS_REASON = 'Direction, colour, softness and moving a transition off the cut arrive with the pro sheets (M3). Until then they keep their defaults; the full editor has them: tap the project name, then Full editor.';

/** The cut this sheet edits: the remembered target, else the cut of the selected clip. */
function initialCut(): PhoneCut | null {
  const timeline = useTimelineStore.getState();
  const fromTarget = resolvePhoneCut(timeline.clips, usePhoneTransitionTargetStore.getState().target);
  if (fromTarget) return fromTarget;
  const primary = timeline.primarySelectedClipId && timeline.selectedClipIds.has(timeline.primarySelectedClipId)
    ? timeline.primarySelectedClipId
    : [...timeline.selectedClipIds][0];
  return primary ? phoneCutForClip(timeline.clips, primary) : null;
}

function glyphOf(name: string): string {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)} s`;
}

export const PhoneTransitionSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Transition');
  const [cut] = useState<PhoneCut | null>(initialCut);
  const target = useMemo<PhoneCutTarget | null>(() => (cut ? { trackId: cut.trackId, clipAId: cut.clipAId, clipBId: cut.clipBId } : null), [cut]);
  const clips = useTimelineStore((state) => state.clips);
  const catalog = useMemo(() => phoneTransitionCatalog(), []);
  const original = cut?.transition ?? null;
  const [choice, setChoice] = useState<PhoneTransitionChoice>(original?.type ?? 'none');
  const [duration, setDuration] = useState(original?.duration ?? DEFAULT_DURATION);
  const [scope, setScope] = useState<'cut' | 'track'>('cut');
  const [category, setCategory] = useState<TransitionCategory>(
    () => catalog.find((group) => group.transitions.some((definition) => definition.id === original?.type))?.category ?? catalog[0]?.category ?? 'dissolve',
  );
  const [problems, setProblems] = useState<string[]>([]);
  const [timingNote, setTimingNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const originalPlayhead = useRef(useTimelineStore.getState().playheadPosition);

  // Remember the cut for the button highlight, show the transition's middle, and forget it on close.
  useEffect(() => {
    const timeline = useTimelineStore.getState();
    if (target) usePhoneTransitionTargetStore.getState().setTarget(target);
    if (cut) {
      if (timeline.isPlaying) timeline.pause();
      timeline.setPlayheadPosition(cut.time);
    }
    return () => usePhoneTransitionTargetStore.getState().setTarget(null);
  }, [cut, target]);

  const trackCutCount = useMemo(() => (target ? phoneTransitionScopeCuts(clips, target, 'track').length : 0), [clips, target]);
  const liveCut = useMemo(() => resolvePhoneCut(clips, target), [clips, target]);
  const clipName = (id: string | undefined) => clips.find((clip) => clip.id === id)?.name ?? 'clip';

  const refreshNotes = (desired: PhoneTransitionDesired) => {
    if (!target || desired.type === 'none') { setTimingNote(null); return; }
    const timing = phoneTransitionTiming(target);
    const parts: string[] = [];
    if (timing && Math.abs(timing.resolvedDuration - desired.duration) > 1e-3) parts.push(`The editor set ${formatSeconds(timing.resolvedDuration)} (its minimum for this look).`);
    if (timing && timing.holdSeconds > 1e-3) parts.push(`A clip runs out of footage here: its edge frame holds for ${formatSeconds(timing.holdSeconds)}.`);
    setTimingNote(parts.length > 0 ? parts.join(' ') : null);
  };

  const apply = (desired: PhoneTransitionDesired, nextScope: 'cut' | 'track') => {
    if (!target) return;
    let report: ReturnType<typeof applyPhoneTransition> | null = null;
    void session.apply(() => { report = applyPhoneTransition(target, nextScope, desired); }).then(() => {
      setProblems(report?.problems ?? []);
      refreshNotes(desired);
    });
  };

  const pick = (type: PhoneTransitionChoice) => {
    setChoice(type);
    apply({ type, duration }, scope);
  };

  const changeDuration = (value: number) => {
    const next = Math.min(PHONE_TRANSITION_MAX_DURATION, Math.max(PHONE_TRANSITION_MIN_DURATION, Math.round(value * 10) / 10));
    setDuration(next);
    if (choice !== 'none') apply({ type: choice, duration: next }, scope);
  };

  const applyToAll = () => {
    if (scope === 'track') {
      showToast('Every cut on this track already follows this sheet. Cancel keeps the other cuts as they were.', 'info');
      return;
    }
    if (trackCutCount <= 1) {
      usePhoneUiStore.getState().showUnavailable({ actionId: IDS.applyAll, label: 'Apply to all cuts', reason: 'This track has only this one cut.' });
      return;
    }
    setScope('track');
    apply({ type: choice, duration }, 'track');
  };

  const done = async () => {
    if (busy || !target) return;
    setBusy(true);
    const desired = { type: choice, duration };
    const result = await session.commit(session.changed ? () => { applyPhoneTransition(target, scope, desired); } : undefined);
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    if (cut) useTimelineStore.getState().setPlayheadPosition(originalPlayhead.current);
    closeSheet();
  };

  if (!cut || !target) {
    return (
      <PhoneSheet title="Transition" onCancel={cancel} onDone={() => undefined} doneDisabled>
        <p className="phone-transition-sheet__empty" data-testid={IDS.empty}>
          This clip touches no other clip on its track. A transition goes between two clips that meet at a cut:
          move them together, or tap the square at a cut on the timeline.
        </p>
      </PhoneSheet>
    );
  }

  const group = catalog.find((entry) => entry.category === category) ?? catalog[0];
  const status = `Between ${clipName(cut.clipAId)} and ${clipName(cut.clipBId)}`;
  const applyAllLabel = scope === 'track' ? `Applied to all ${trackCutCount} cuts` : `Apply to all cuts (${trackCutCount})`;

  return (
    <PhoneSheet title="Transition" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-transition-sheet">
        <p className="phone-transition-sheet__status" data-testid={IDS.status}>
          {status}
          {liveCut?.transition ? ` · ${liveCut.transition.type}, ${formatSeconds(liveCut.transition.duration)}` : ' · no transition'}
        </p>
        <div className="phone-transition-sheet__categories" role="group" aria-label="Transition families">
          {catalog.map((entry) => (
            <PhoneChoice
              key={entry.category}
              label={entry.label}
              selected={entry.category === category}
              testId={phoneTransitionCategoryTestId(entry.category)}
              onSelect={() => setCategory(entry.category)}
            />
          ))}
        </div>
        <div className="phone-transition-sheet__grid" role="group" aria-label={`${group?.label ?? ''} transitions`}>
          <PhoneChoice
            variant="tile"
            label="None"
            glyph="–"
            selected={choice === 'none'}
            testId={phoneTransitionChoiceTestId('none')}
            onSelect={() => pick('none')}
          />
          {group?.transitions.map((definition) => (
            <PhoneChoice
              key={definition.id}
              variant="tile"
              label={definition.name}
              glyph={glyphOf(definition.name)}
              selected={choice === definition.id}
              testId={phoneTransitionChoiceTestId(definition.id)}
              unavailableReason={phoneTransitionUnavailableReason(clips, cut, definition.id)}
              onSelect={() => pick(definition.id)}
            />
          ))}
        </div>
        <label className="phone-transition-sheet__duration">
          <span className="phone-transition-sheet__duration-head">
            <span>Duration</span>
            <span data-testid={IDS.durationValue}>{formatSeconds(duration)}</span>
          </span>
          <input
            type="range"
            className="phone-range"
            aria-label="Transition duration in seconds"
            min={PHONE_TRANSITION_MIN_DURATION}
            max={PHONE_TRANSITION_MAX_DURATION}
            step={0.1}
            value={duration}
            data-testid={IDS.duration}
            onPointerUp={blurAfterPointer}
            onChange={(event) => changeDuration(Number(event.target.value))}
          />
        </label>
        {(problems.length > 0 || timingNote) && (
          <p className={`phone-transition-sheet__message${problems.length > 0 ? ' phone-transition-sheet__message--error' : ''}`} role="status" data-testid={IDS.message}>
            {[...problems, ...(timingNote ? [timingNote] : [])].join(' ')}
          </p>
        )}
        <button
          type="button"
          className="phone-transition-sheet__apply-all"
          aria-pressed={scope === 'track'}
          aria-disabled={trackCutCount <= 1 || undefined}
          data-testid={IDS.applyAll}
          onPointerUp={blurAfterPointer}
          onClick={applyToAll}
        >
          {applyAllLabel}
        </button>
        <PhoneGreyedOption label="Settings and offset" reason={SETTINGS_REASON} testId={IDS.settings} />
      </div>
    </PhoneSheet>
  );
};
