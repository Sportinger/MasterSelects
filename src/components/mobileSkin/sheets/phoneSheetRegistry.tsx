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
};

export function isPhoneSheetId(value: string | null): value is PhoneSheetId {
  return value !== null && Object.prototype.hasOwnProperty.call(PHONE_SHEET_REGISTRY, value);
}
