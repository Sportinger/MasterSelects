// View tab of the Timeline sheet: the editor's track focus (balanced / video / audio), filmstrip
// thumbnails and waveforms. The phone timeline reads the same settings (lane heights follow the
// focus, tiles draw thumbnails and waveforms only when they are on), so the desktop and the phone
// stay in step. The edited content never changes here.

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrackFocusMode } from '../../../stores/timeline/types';
import { PHONE_FULL_EDITOR_HINT } from '../contracts';
import { ProSection } from '../compositions/phoneProControls';
import { PhoneChoice, PhoneGreyedOption, PhoneSwitch } from '../transition/phoneChoiceControls';
import { PHONE_TIMELINE_TOOLS_TEST_IDS as IDS } from './phoneTimelineToolsTestIds';

const FOCUS: ReadonlyArray<{ id: TimelineTrackFocusMode; label: string }> = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'video', label: 'Video focus' },
  { id: 'audio', label: 'Audio focus' },
];

const MORE_LANES_REASON = `The spectrum view, face regions, transcript and note lanes are drawn only by the full editor's timeline; the phone timeline shows thumbnails and waveforms. ${PHONE_FULL_EDITOR_HINT}`;

export function PhoneTimelineViewTab() {
  const focus = useTimelineStore((state) => state.trackFocusMode);
  const thumbnails = useTimelineStore((state) => state.thumbnailsEnabled);
  const waveforms = useTimelineStore((state) => state.waveformsEnabled);
  return (
    <>
      <ProSection title="Track focus">
        <div className="phone-pro-chips" role="group" aria-label="Track focus">
          {FOCUS.map((option) => (
            <PhoneChoice key={option.id} label={option.label} selected={focus === option.id} testId={`${IDS.viewFocus}-${option.id}`}
              onSelect={() => useTimelineStore.getState().setTrackFocusMode(option.id)} />
          ))}
        </div>
      </ProSection>
      <ProSection title="Show on clips">
        <PhoneSwitch label="Thumbnails" hint="Pictures along video clips." checked={thumbnails} testId={IDS.viewThumbnails}
          onChange={(checked) => useTimelineStore.getState().setThumbnailsEnabled(checked)} />
        <PhoneSwitch label="Waveforms" hint="The sound along audio clips." checked={waveforms} testId={IDS.viewWaveforms}
          onChange={(checked) => useTimelineStore.getState().setWaveformsEnabled(checked)} />
        <PhoneGreyedOption label="Spectrum, faces, transcript lanes" reason={MORE_LANES_REASON} testId={IDS.viewMoreLanes} />
      </ProSection>
    </>
  );
}
