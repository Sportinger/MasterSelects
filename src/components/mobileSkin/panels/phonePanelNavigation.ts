// Opening the desktop Properties panel on the phone at the right place: a clip (or a transition)
// selected the way the desktop selects it, and the right inspector tab. The tab request is held
// until the panel view mounts and then sent through the desktop's own 'openPropertiesTab' event,
// so the phone never reaches into the Properties panel's internals.

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import type { PropertiesTab } from '../../panels/properties/propertiesPanelTypes';
import type { PhoneActionResult } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';

const log = Logger.create('PhonePanelNavigation');

export const PHONE_PROPERTIES_TITLE = 'Properties';

let pendingPropertiesTab: PropertiesTab | null = null;

export type PhonePropertiesTarget =
  | { kind: 'clip'; clipId: string; tab?: PropertiesTab }
  | { kind: 'transition'; clipId: string; edge: 'in' | 'out' }
  | { kind: 'current'; tab?: PropertiesTab };

/** Selects the target like the desktop does and opens the Properties panel sheet. */
export function openPhoneProperties(target: PhonePropertiesTarget): PhoneActionResult {
  const timeline = useTimelineStore.getState();
  if (target.kind === 'clip') {
    if (!timeline.clips.some((clip) => clip.id === target.clipId)) {
      return { ok: false, message: 'That clip is no longer on the timeline.' };
    }
    timeline.selectClip(target.clipId);
    pendingPropertiesTab = target.tab ?? null;
  } else if (target.kind === 'transition') {
    const clip = timeline.clips.find((candidate) => candidate.id === target.clipId);
    const transition = target.edge === 'in' ? clip?.transitionIn : clip?.transitionOut;
    if (!clip || !transition) {
      return { ok: false, message: 'There is no transition at this cut yet. Pick one first, then open its settings.' };
    }
    timeline.selectTransitionProperties(clip.id, target.edge, transition.id);
    pendingPropertiesTab = null;
  } else {
    pendingPropertiesTab = target.tab ?? null;
  }
  usePhoneUiStore.getState().openPanelSheet('clip-properties', PHONE_PROPERTIES_TITLE);
  return { ok: true };
}

/** Taken once by the panel view after it mounted. */
export function takePendingPropertiesTab(): PropertiesTab | null {
  const tab = pendingPropertiesTab;
  pendingPropertiesTab = null;
  return tab;
}

/** Sends the desktop's tab request; the Properties panel listens while it is mounted. */
export function requestPropertiesTab(tab: PropertiesTab): void {
  try {
    window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
  } catch (error) {
    log.warn('Could not ask the Properties panel for a tab', { tab, error });
  }
}
