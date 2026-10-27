// 'panel' sheet: one desktop panel (Properties, Media, Export, AI Studio, ...) in a tall sheet under the
// preview. The panel edits through its own store actions, so each change is a normal undo step.
// "All tools" in the header leads back to the list of every tool and panel.
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhonePanelView } from './PhonePanelView';
import { PHONE_PANELS_TEST_IDS as IDS } from './phonePanelsTestIds';

export const PhonePanelSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const panel = usePhoneUiStore((state) => state.panelSheet);
  return (
    <PhoneSheet
      title={panel?.title ?? 'Panel'}
      height="tall"
      onCancel={closeSheet}
      cancelLabel="Close"
      onDone={() => openSheet('allTools')}
      doneLabel="All tools"
    >
      {panel
        ? <PhonePanelView key={panel.type} type={panel.type} title={panel.title} />
        : <p className="phone-sheet__note" data-testid={IDS.panelEmpty}>No panel was chosen. Open one from All tools.</p>}
    </PhoneSheet>
  );
};
