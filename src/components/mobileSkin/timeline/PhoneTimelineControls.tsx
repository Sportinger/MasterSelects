// The row under the phone timeline: the snapping magnet and the metronome (direct toggles of the
// editor's own settings, like the desktop timeline buttons), In and Out at the playhead with the
// editor's setInPoint/setOutPoint, clear range, and "Timeline" for every other timeline setting.
// Each button is at least 44 px wide, explains what happened in a toast when the editor moved a
// mark, drops pointer focus after a tap and keeps a styled :focus-visible ring for the keyboard.

import type { ReactNode } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { openPhoneTimelineTools } from '../timelineTools/phoneTimelineToolsOpen';
import { setPhoneRangeMark } from '../timelineTools/phoneTimelinePrefs';
import { PHONE_TIMELINE_CONTROLS_TEST_IDS as IDS } from '../timelineTools/phoneTimelineToolsTestIds';

interface ControlProps {
  label: string;
  testId: string;
  pressed?: boolean;
  onPress: () => void;
  children: ReactNode;
}

function Control({ label, testId, pressed, onPress, children }: ControlProps) {
  return (
    <button
      type="button"
      className="phone-timeline-controls__button"
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      onPointerUp={(event) => event.currentTarget.blur()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

function MagnetGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 3v7a5 5 0 0 0 10 0V3" />
      <path d="M5 6h3M12 6h3" />
    </svg>
  );
}

function MetronomeGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      <path d="M7 3h6l3 14H4z" />
      <path d="M10 13l4-7" />
    </svg>
  );
}

export function PhoneTimelineControls() {
  const snapping = useTimelineStore((state) => state.snappingEnabled);
  const metronome = useTimelineStore((state) => state.metronomeEnabled);
  const hasRange = useTimelineStore((state) => state.inPoint !== null || state.outPoint !== null);
  const showToast = usePhoneUiStore((state) => state.showToast);

  const mark = (edge: 'in' | 'out') => {
    const state = useTimelineStore.getState();
    showToast(setPhoneRangeMark(edge, state.playheadPosition, getActiveCompositionFrameRate()).message);
  };

  return (
    <div className="phone-timeline-controls" role="toolbar" aria-label="Timeline controls" data-testid={IDS.row}>
      <Control label="Snap" testId={IDS.snap} pressed={snapping}
        onPress={() => { useTimelineStore.getState().toggleSnapping(); showToast(snapping ? 'Snapping off: clips move freely.' : 'Snapping on.'); }}>
        <MagnetGlyph />
      </Control>
      <Control label="Metronome" testId={IDS.metronome} pressed={metronome}
        onPress={() => { useTimelineStore.getState().toggleMetronome(); showToast(metronome ? 'Metronome off.' : 'Metronome on: it clicks while playing.'); }}>
        <MetronomeGlyph />
      </Control>
      <Control label="Set In at the playhead" testId={IDS.setIn} onPress={() => mark('in')}>
        <span className="phone-timeline-controls__text">In</span>
      </Control>
      <Control label="Set Out at the playhead" testId={IDS.setOut} onPress={() => mark('out')}>
        <span className="phone-timeline-controls__text">Out</span>
      </Control>
      {hasRange ? (
        <Control label="Clear the in/out range" testId={IDS.clearRange}
          onPress={() => { useTimelineStore.getState().clearInOut(); showToast('Range cleared: export uses the whole composition.'); }}>
          <span className="phone-timeline-controls__text">✕</span>
        </Control>
      ) : null}
      <Control label="Timeline settings" testId={IDS.more} onPress={() => openPhoneTimelineTools(hasRange ? 'range' : 'snap')}>
        <span className="phone-timeline-controls__text">Timeline</span>
      </Control>
    </div>
  );
}
