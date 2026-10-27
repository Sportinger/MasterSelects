// Opens the desktop Properties panel inside the phone (the 'panel' sheet) on a given inspector tab,
// for "All parameters" rows. The tab request uses the panel's own 'openPropertiesTab' event, sent
// once the panel is mounted (it only listens while mounted). Callers commit their own sheet first:
// opening the panel replaces the open sheet.

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';

const log = Logger.create('PhonePropertiesPanel');
const MAX_FRAMES = 240;

export type PhonePropertiesTab = 'effects' | 'audio-edits' | 'captions' | 'analysis' | 'text';

function requestTab(tab: PhonePropertiesTab): void {
  window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
}

export function openPhonePropertiesPanel(options: { clipId?: string | null; tab?: PhonePropertiesTab; title?: string } = {}): void {
  const { clipId, tab, title = 'Properties' } = options;
  const timeline = useTimelineStore.getState();
  if (clipId && !(timeline.selectedClipIds.size === 1 && timeline.selectedClipIds.has(clipId))) {
    timeline.selectClips([clipId], { revealProperties: false });
  }
  usePhoneUiStore.getState().openPanelSheet('clip-properties', title);
  if (!tab || typeof window === 'undefined') return;
  let frames = 0;
  const wait = () => {
    const host = document.querySelector('[data-testid="phone-panel-host"][data-panel-type="clip-properties"]');
    if (host?.querySelector('.properties-content, .properties-panel, [class*="properties"]')) {
      requestTab(tab);
      // The panel registers its listener in an effect; repeat once after that effect has run.
      requestAnimationFrame(() => requestTab(tab));
      return;
    }
    frames += 1;
    if (frames > MAX_FRAMES) {
      log.warn('The Properties panel did not mount; the requested tab was not opened', { tab });
      return;
    }
    requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}
