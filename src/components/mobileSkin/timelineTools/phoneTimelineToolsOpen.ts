// Opens the Timeline sheet on a given tab (the timeline control row's "More" opens Snap, a long
// press on In/Out opens Range). One plain string waits for the sheet to mount; nothing durable.

import { usePhoneUiStore } from '../state/phoneUiStore';

export type PhoneTimelineToolsTab = 'snap' | 'range' | 'tempo' | 'view';

let requestedTab: PhoneTimelineToolsTab | null = null;

export function openPhoneTimelineTools(tab: PhoneTimelineToolsTab = 'snap'): void {
  requestedTab = tab;
  usePhoneUiStore.getState().openSheet('timelineTools');
}

/** The tab asked for (and forgets it); 'snap' when the sheet was opened some other way. */
export function takePhoneTimelineToolsTab(): PhoneTimelineToolsTab {
  const tab = requestedTab ?? 'snap';
  requestedTab = null;
  return tab;
}
