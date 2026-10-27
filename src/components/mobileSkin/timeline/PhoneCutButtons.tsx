// Transition buttons at the cuts of the phone timeline: one small square at every cut between two
// touching clips on the same track (transition/phoneTransitionCuts.ts), with a 44 px hit area,
// filled when the cut has a transition. Tapping one targets that cut and opens the transition
// sheet. Buttons live in the clip layer (content coordinates), so panning moves them with the
// clips; the navigation hook turns a tap on one (data-phone-cut) into its click, never a selection,
// while a drag that starts on one scrubs as anywhere else.
// Cuts at the edges of the clip that shows trim handles stay hidden there (the handles own that
// spot; the Transition tool reaches those cuts), as do cuts whose clips are too narrow to tell
// apart at the current zoom, and all of them during a trim or move gesture.

import { memo, type PointerEvent } from 'react';

import type { TimelineClip } from '../../../types/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { phoneCutKey, type PhoneCut } from '../transition/phoneTransitionCuts';
import { PHONE_TRANSITION_TEST_IDS } from '../transition/phoneTransitionTestIds';
import { usePhoneTransitionTargetStore } from '../transition/phoneTransitionTargetStore';
import type { PhoneLane } from './PhoneClipStrip';
import type { PhoneTimeWindow } from './phoneTimelineGeometry';
import { usePhoneClipEditPreviewStore } from './usePhoneClipEditGesture';

export const PHONE_CUT_HIT_SIZE = 44;
/**
 * Each neighbour must be at least this wide on screen: the button reaches 22 px into both clips,
 * so the clip's centre (where a tap selects it) stays free with room to spare.
 */
export const PHONE_CUT_MIN_CLIP_PX = 72;
export const PHONE_CUT_SELECTOR = '[data-phone-cut]';

interface PhoneCutButtonsProps {
  lanes: readonly PhoneLane[];
  cutsByTrack: ReadonlyMap<string, readonly PhoneCut[]>;
  clipsById: ReadonlyMap<string, Pick<TimelineClip, 'duration' | 'name'>>;
  zoom: number;
  timeWindow: PhoneTimeWindow;
  /** The clip that shows trim handles (primary selection), whose edges stay free. */
  handleClipId: string | null;
}

function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  // Keyboard activation never sends pointerup, so keyboard focus (and :focus-visible) stays.
  event.currentTarget.blur();
}

export function openPhoneTransitionAtCut(cut: Pick<PhoneCut, 'trackId' | 'clipAId' | 'clipBId'>): void {
  usePhoneTransitionTargetStore.getState().setTarget({ trackId: cut.trackId, clipAId: cut.clipAId, clipBId: cut.clipBId });
  usePhoneUiStore.getState().openSheet('transition');
}

export const PhoneCutButtons = memo(function PhoneCutButtons({
  lanes, cutsByTrack, clipsById, zoom, timeWindow, handleClipId,
}: PhoneCutButtonsProps) {
  const gestureActive = usePhoneClipEditPreviewStore((state) => state.preview !== null);
  const target = usePhoneTransitionTargetStore((state) => state.target);
  const sheetOpen = usePhoneUiStore((state) => state.activeSheet === 'transition');
  if (gestureActive) return null;
  const activeKey = sheetOpen && target ? phoneCutKey(target) : null;

  return (
    <>
      {lanes.map((lane) => (cutsByTrack.get(lane.trackId) ?? []).map((cut) => {
        if (cut.time < timeWindow.start || cut.time > timeWindow.end) return null;
        if (handleClipId !== null && (cut.clipAId === handleClipId || cut.clipBId === handleClipId)) return null;
        const a = clipsById.get(cut.clipAId);
        const b = clipsById.get(cut.clipBId);
        if (!a || !b || a.duration * zoom < PHONE_CUT_MIN_CLIP_PX || b.duration * zoom < PHONE_CUT_MIN_CLIP_PX) return null;
        const key = phoneCutKey(cut);
        const has = cut.transition !== null;
        const label = has
          ? `Transition between ${a.name} and ${b.name}: ${cut.transition!.type}. Tap to change it.`
          : `Add a transition between ${a.name} and ${b.name}`;
        return (
          <button
            key={key}
            type="button"
            className={`phone-cut${has ? ' phone-cut--has' : ''}${activeKey === key ? ' phone-cut--active' : ''}`}
            aria-label={label}
            aria-pressed={activeKey === key}
            data-phone-cut=""
            data-testid={PHONE_TRANSITION_TEST_IDS.cutButton}
            data-clip-a={cut.clipAId}
            data-clip-b={cut.clipBId}
            data-track-id={cut.trackId}
            data-has-transition={has ? 'true' : 'false'}
            style={{
              left: cut.time * zoom - PHONE_CUT_HIT_SIZE / 2,
              top: lane.top + lane.height / 2 - PHONE_CUT_HIT_SIZE / 2,
              width: PHONE_CUT_HIT_SIZE,
              height: PHONE_CUT_HIT_SIZE,
            }}
            onPointerUp={blurAfterPointer}
            onClick={() => openPhoneTransitionAtCut(cut)}
          >
            <span className="phone-cut__mark" aria-hidden="true">
              <svg viewBox="0 0 20 16" width="14" height="12">
                <path d="M2 2 L10 8 L2 14 Z M18 2 L10 8 L18 14 Z" />
              </svg>
            </span>
          </button>
        );
      }))}
    </>
  );
});
