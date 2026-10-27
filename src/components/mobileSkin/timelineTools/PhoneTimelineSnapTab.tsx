// Snap tab of the Timeline sheet: the editor's snapping toggle (what the phone's move and trim
// gestures honour, see timeline/phoneTimelineSnap.ts), the beat grid (a Bars ruler lane: the editor
// snaps to beats only while one exists, and the phone ruler then draws the beats) and its division.

import { useTimelineStore } from '../../../stores/timeline';
import { TIMELINE_GRID_SUBDIVISIONS, TIMELINE_GRID_SUBDIVISION_LABELS } from '../../../timeline/tempo/barsGrid';
import { ProSection } from '../compositions/phoneProControls';
import { PhoneChoice, PhoneSwitch } from '../transition/phoneChoiceControls';
import { hasBeatGrid, setPhoneBeatGrid } from './phoneTimelinePrefs';
import { PHONE_TIMELINE_TOOLS_TEST_IDS as IDS, phoneGridChipTestId } from './phoneTimelineToolsTestIds';

const GRID_OFF_REASON = 'Turn on the beat grid first: the division sets which beats clips snap to and the ruler shows.';

/** `change` runs a write inside the sheet's edit session (the beat grid is a ruler lane: project content). */
export function PhoneTimelineSnapTab({ change }: { change: (apply: () => void) => void }) {
  const snapping = useTimelineStore((state) => state.snappingEnabled);
  const grid = useTimelineStore(hasBeatGrid);
  const subdivision = useTimelineStore((state) => state.timelineGridSubdivision);

  return (
    <>
      <ProSection title="Snapping">
        <PhoneSwitch
          label="Snap clips"
          hint="Moved clips and trim handles snap to clip edges, the playhead, markers and the beat grid. Off moves freely."
          checked={snapping}
          testId={IDS.snapSwitch}
          onChange={() => useTimelineStore.getState().toggleSnapping()}
        />
      </ProSection>
      <ProSection title="Beat grid">
        <PhoneSwitch
          label="Show beats and snap to them"
          hint="Uses the project tempo (Tempo tab). The ruler shows bars and beats."
          checked={grid}
          testId={IDS.gridSwitch}
          onChange={(checked) => change(() => setPhoneBeatGrid(checked))}
        />
        <div className="phone-pro-chips" role="group" aria-label="Grid division">
          {TIMELINE_GRID_SUBDIVISIONS.map((value) => (
            <PhoneChoice
              key={value}
              label={TIMELINE_GRID_SUBDIVISION_LABELS[value]}
              selected={subdivision === value}
              testId={phoneGridChipTestId(value)}
              unavailableReason={grid ? null : GRID_OFF_REASON}
              onSelect={() => useTimelineStore.getState().setTimelineGridSubdivision(value)}
            />
          ))}
        </div>
      </ProSection>
    </>
  );
}
