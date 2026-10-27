// 'timelineTools' sheet (root action "Timeline", the timeline row's More button): snapping and the
// beat grid, the in/out range, the tempo map and metronome, and the view options, all through the
// editor's own timeline actions. Tempo edits are content and run in ONE owned edit session (Done is
// one undo step, Cancel rolls them back). The beat grid (a ruler lane) and the in/out range are project
// content in the editor's repository, so they run in the same session: a write outside an open
// transaction would be dropped when it commits. The plain preferences (snapping, division,
// metronome, view) are no undo steps in the editor either; the sheet snapshots everything and
// Cancel restores it.

import { useRef, useState } from 'react';

import { Logger } from '../../../services/logger';
import { getActiveCompositionFrameRate } from '../../../stores/timeline/editOperations/activeCompositionFrameRate';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent, PhoneSheetId } from '../contracts';
import { ProMessage } from '../compositions/phoneProControls';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneTabs } from '../transition/phoneChoiceControls';
import { readPhoneTimelinePrefs, restorePhoneTimelinePrefs } from './phoneTimelinePrefs';
import { takePhoneTimelineToolsTab, type PhoneTimelineToolsTab } from './phoneTimelineToolsOpen';
import { PHONE_TIMELINE_TOOLS_TEST_IDS as IDS } from './phoneTimelineToolsTestIds';
import { PhoneTimelineRangeTab } from './PhoneTimelineRangeTab';
import { PhoneTimelineSnapTab } from './PhoneTimelineSnapTab';
import { PhoneTimelineTempoTab } from './PhoneTimelineTempoTab';
import { PhoneTimelineViewTab } from './PhoneTimelineViewTab';
import './PhoneTimelineTools.css';

const log = Logger.create('PhoneTimelineTools');

const TABS: ReadonlyArray<{ id: PhoneTimelineToolsTab; label: string; testId: string }> = [
  { id: 'snap', label: 'Snap', testId: IDS.tabSnap },
  { id: 'range', label: 'Range', testId: IDS.tabRange },
  { id: 'tempo', label: 'Tempo', testId: IDS.tabTempo },
  { id: 'view', label: 'View', testId: IDS.tabView },
];

export const PhoneTimelineToolsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Timeline settings');
  const prefsRef = useRef(readPhoneTimelinePrefs());
  const [tab, setTab] = useState<PhoneTimelineToolsTab>(takePhoneTimelineToolsTab);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fps = getActiveCompositionFrameRate();

  const change = (apply: (store: ReturnType<typeof useTimelineStore.getState>) => void) => {
    setMessage(null);
    void session.apply(() => apply(useTimelineStore.getState()));
  };

  const commit = async (): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const result = await session.commit();
    if (!result.ok) showToast(result.message, 'error');
    return true;
  };

  const done = async () => {
    if (await commit()) closeSheet();
  };

  /** Bake / Compare: keep what was done here (like Done), then open the other sheet. */
  const leave = async (sheet: PhoneSheetId) => {
    if (await commit()) openSheet(sheet);
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
    // Grid and range ran inside the session, whose rollback restores them; the rest are preferences.
    try {
      restorePhoneTimelinePrefs(prefsRef.current, { content: false });
    } catch (error) {
      log.error('Restoring the timeline settings failed', error);
      showToast('Some timeline settings could not be put back; check Timeline → Snap and View.', 'error');
    }
  };

  return (
    <PhoneSheet title="Timeline" height="tall" onCancel={cancel} onDone={() => void done()} doneDisabled={busy}>
      <div className="phone-tltools" data-testid={IDS.root} data-tab={tab}>
        <PhoneTabs label="Timeline settings" tabs={TABS} active={tab} onSelect={(next) => { setMessage(null); setTab(next); }} />
        {tab !== 'range' ? <ProMessage text={message} testId={IDS.message} /> : null}
        {tab === 'snap' ? <PhoneTimelineSnapTab change={(apply) => change(apply)} /> : null}
        {tab === 'range' ? <PhoneTimelineRangeTab fps={fps} change={(apply) => change(apply)} onLeave={(sheet) => void leave(sheet)} /> : null}
        {tab === 'tempo' ? <PhoneTimelineTempoTab fps={fps} change={change} report={setMessage} /> : null}
        {tab === 'view' ? <PhoneTimelineViewTab /> : null}
      </div>
    </PhoneSheet>
  );
};
