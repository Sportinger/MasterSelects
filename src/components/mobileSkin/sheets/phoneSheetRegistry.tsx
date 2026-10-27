// Lazy map from sheet id to its component, so the sheets' code (project list, media picker,
// title editor, export, the M2 design sheets) loads only when a sheet opens.
import { lazy, type LazyExoticComponent } from 'react';
import type { PhoneSheetComponent, PhoneSheetId } from '../contracts';

export const PHONE_SHEET_REGISTRY: Readonly<Record<PhoneSheetId, LazyExoticComponent<PhoneSheetComponent>>> = {
  projects: lazy(() => import('../project/PhoneProjectSheet').then((m) => ({ default: m.PhoneProjectSheet }))),
  media: lazy(() => import('../media/PhoneMediaSheet').then((m) => ({ default: m.PhoneMediaSheet }))),
  title: lazy(() => import('../text/PhoneTitleSheet').then((m) => ({ default: m.PhoneTitleSheet }))),
  export: lazy(() => import('../export/PhoneExportSheet').then((m) => ({ default: m.PhoneExportSheet }))),
  assistant: lazy(() => import('../assistant/PhoneAssistantSheet').then((m) => ({ default: m.PhoneAssistantSheet }))),
  // M2 design sheets.
  effects: lazy(() => import('../effects/PhoneEffectsSheet').then((m) => ({ default: m.PhoneEffectsSheet }))),
  filters: lazy(() => import('../effects/PhoneFiltersSheet').then((m) => ({ default: m.PhoneFiltersSheet }))),
  adjust: lazy(() => import('../effects/PhoneAdjustSheet').then((m) => ({ default: m.PhoneAdjustSheet }))),
  transition: lazy(() => import('../transition/PhoneTransitionSheet').then((m) => ({ default: m.PhoneTransitionSheet }))),
  speed: lazy(() => import('../speed/PhoneSpeedSheet').then((m) => ({ default: m.PhoneSpeedSheet }))),
  volume: lazy(() => import('../audio/PhoneVolumeSheet').then((m) => ({ default: m.PhoneVolumeSheet }))),
  audio: lazy(() => import('../audio/PhoneAudioSheet').then((m) => ({ default: m.PhoneAudioSheet }))),
  animation: lazy(() => import('../animation/PhoneAnimationSheet').then((m) => ({ default: m.PhoneAnimationSheet }))),
  keyframe: lazy(() => import('../keyframe/PhoneKeyframeSheet').then((m) => ({ default: m.PhoneKeyframeSheet }))),
  mask: lazy(() => import('../mask/PhoneMaskSheet').then((m) => ({ default: m.PhoneMaskSheet }))),
  crop: lazy(() => import('../crop/PhoneCropSheet').then((m) => ({ default: m.PhoneCropSheet }))),
  overlay: lazy(() => import('../overlay/PhoneOverlaySheet').then((m) => ({ default: m.PhoneOverlaySheet }))),
  format: lazy(() => import('../format/PhoneFormatSheet').then((m) => ({ default: m.PhoneFormatSheet }))),
  // M4 landscape editors list.
  editors: lazy(() => import('../workspace/PhoneEditorsSheet').then((m) => ({ default: m.PhoneEditorsSheet }))),
  // M3 pro sheets.
  panel: lazy(() => import('../panels/PhonePanelSheet').then((m) => ({ default: m.PhonePanelSheet }))),
  allTools: lazy(() => import('../panels/PhoneAllToolsSheet').then((m) => ({ default: m.PhoneAllToolsSheet }))),
  compositions: lazy(() => import('../compositions/PhoneCompositionsSheet').then((m) => ({ default: m.PhoneCompositionsSheet }))),
  tracks: lazy(() => import('../tracks/PhoneTracksSheet').then((m) => ({ default: m.PhoneTracksSheet }))),
  markers: lazy(() => import('../markers/PhoneMarkersSheet').then((m) => ({ default: m.PhoneMarkersSheet }))),
  edits: lazy(() => import('../edits/PhoneEditsSheet').then((m) => ({ default: m.PhoneEditsSheet }))),
  replace: lazy(() => import('../replace/PhoneReplaceSheet').then((m) => ({ default: m.PhoneReplaceSheet }))),
  captions: lazy(() => import('../captions/PhoneCaptionsSheet').then((m) => ({ default: m.PhoneCaptionsSheet }))),
  audioFx: lazy(() => import('../audiofx/PhoneAudioFxSheet').then((m) => ({ default: m.PhoneAudioFxSheet }))),
  library: lazy(() => import('../library/PhoneLibrarySheet').then((m) => ({ default: m.PhoneLibrarySheet }))),
  settings: lazy(() => import('../settings/PhoneSettingsSheet').then((m) => ({ default: m.PhoneSettingsSheet }))),
};

export function isPhoneSheetId(value: string | null): value is PhoneSheetId {
  return value !== null && Object.prototype.hasOwnProperty.call(PHONE_SHEET_REGISTRY, value);
}
