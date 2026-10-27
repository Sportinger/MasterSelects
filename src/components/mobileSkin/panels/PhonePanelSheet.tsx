// 'panel' sheet: one desktop panel (Properties, Media, Export, AI Studio, ...) in a tall sheet under the
// preview. The panel edits through its own store actions, so each change is a normal undo step.
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhonePanelView } from './PhonePanelView';

export const PhonePanelSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const panel = usePhoneUiStore((state) => state.panelSheet);
  return (
    <PhoneSheet title={panel?.title ?? 'Panel'} height="tall" onCancel={closeSheet} cancelLabel="Close">
      {panel
        ? <PhonePanelView type={panel.type} title={panel.title} />
        : <p className="phone-sheet__note">No panel was chosen. Open one from All tools.</p>}
    </PhoneSheet>
  );
};
