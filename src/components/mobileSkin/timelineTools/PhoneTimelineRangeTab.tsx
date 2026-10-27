// Range tab of the Timeline sheet: the composition's in/out range (what export and loop playback
// use) set at the playhead with the editor's setInPoint/setOutPoint, nudged by frames, cleared, and
// loop playback. The phone ruler shows the band. From here the range can be baked or compared.

import { useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { ProButton, ProMessage, ProSection, ProStepper } from '../compositions/phoneProControls';
import type { PhoneSheetId } from '../contracts';
import { PhoneSwitch } from '../transition/phoneChoiceControls';
import { formatPhoneRangeTime, phoneRangeSpan, setPhoneRangeMark } from './phoneTimelinePrefs';
import { PHONE_TIMELINE_TOOLS_TEST_IDS as IDS } from './phoneTimelineToolsTestIds';

const FRAME_STEPS = [
  { label: '−10f', delta: -10 }, { label: '−1f', delta: -1 }, { label: '+1f', delta: 1 }, { label: '+10f', delta: 10 },
] as const;

export interface PhoneRangeTabProps {
  fps: number;
  onLeave: (sheet: PhoneSheetId) => void;
  /** Runs a write inside the sheet's edit session (in/out are project content in the repository). */
  change: (apply: () => void) => void;
}

export function PhoneTimelineRangeTab({ fps, onLeave, change }: PhoneRangeTabProps) {
  const inPoint = useTimelineStore((state) => state.inPoint);
  const outPoint = useTimelineStore((state) => state.outPoint);
  const loop = useTimelineStore((state) => state.loopPlayback);
  const duration = useTimelineStore((state) => state.duration);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const [message, setMessage] = useState<string | null>(null);
  const span = phoneRangeSpan(inPoint, outPoint, duration);
  const frames = span ? Math.round((span.end - span.start) * fps) : 0;

  const mark = (edge: 'in' | 'out', time: number) => change(() => setMessage(setPhoneRangeMark(edge, time, fps).message));
  const step = (edge: 'in' | 'out', delta: number) => {
    const current = edge === 'in' ? inPoint : outPoint;
    if (current === null) return;
    mark(edge, Math.max(0, Math.round(current * fps + delta) / fps));
  };

  return (
    <>
      <ProSection title="In and out">
        <div className="phone-pro-row__actions">
          <ProButton label={`In at ${formatPhoneRangeTime(playhead, fps)}`} testId={IDS.rangeIn} onPress={() => mark('in', playhead)} />
          <ProButton label={`Out at ${formatPhoneRangeTime(playhead, fps)}`} testId={IDS.rangeOut} onPress={() => mark('out', playhead)} />
        </div>
        <p className="phone-tltools__summary" data-testid={IDS.rangeSummary} data-frames={frames}>
          {span
            ? `${formatPhoneRangeTime(span.start, fps)} – ${formatPhoneRangeTime(span.end, fps)} · ${frames} frames. Export and loop use this range.`
            : 'No range: export and loop use the whole composition.'}
        </p>
        <ProMessage text={message} testId={IDS.message} />
        <ProStepper
          label="In"
          value={inPoint === null ? 'not set' : formatPhoneRangeTime(inPoint, fps)}
          steps={FRAME_STEPS}
          testId={IDS.rangeInStep}
          unavailableReason={inPoint === null ? 'Set In at the playhead first, then nudge it by frames.' : null}
          onStep={(delta) => step('in', delta)}
        />
        <ProStepper
          label="Out"
          value={outPoint === null ? 'not set' : formatPhoneRangeTime(outPoint, fps)}
          steps={FRAME_STEPS}
          testId={IDS.rangeOutStep}
          unavailableReason={outPoint === null ? 'Set Out at the playhead first, then nudge it by frames.' : null}
          onStep={(delta) => step('out', delta)}
        />
        <PhoneSwitch label="Loop playback" hint="Play repeats the range (or the whole composition)." checked={loop} testId={IDS.rangeLoop}
          onChange={(checked) => change(() => useTimelineStore.getState().setLoopPlayback(checked))} />
        <ProButton label="Clear range" tone="danger" testId={IDS.rangeClear}
          unavailableReason={span ? null : 'There is no range to clear yet.'}
          onPress={() => change(() => { useTimelineStore.getState().clearInOut(); setMessage('Range cleared.'); })} />
      </ProSection>
      <ProSection title="Use the range">
        <div className="phone-pro-row__actions">
          <ProButton label="Bake this range" testId={IDS.rangeBake}
            unavailableReason={span ? null : 'Set In and Out first: baking pre-renders the marked range.'}
            onPress={() => onLeave('bake')} />
          <ProButton label="Compare alternatives" testId={IDS.rangeCompare} onPress={() => onLeave('variants')} />
        </div>
      </ProSection>
    </>
  );
}
