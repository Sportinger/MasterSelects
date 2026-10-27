// Lazy map from sheet id to its component, so the sheets' code (project list, media picker,
// title editor, export) loads only when a sheet opens.
import { lazy, type LazyExoticComponent } from 'react';
import type { PhoneSheetComponent, PhoneSheetId } from '../contracts';

export const PHONE_SHEET_REGISTRY: Readonly<Record<PhoneSheetId, LazyExoticComponent<PhoneSheetComponent>>> = {
  projects: lazy(() => import('../project/PhoneProjectSheet').then((m) => ({ default: m.PhoneProjectSheet }))),
  media: lazy(() => import('../media/PhoneMediaSheet').then((m) => ({ default: m.PhoneMediaSheet }))),
  title: lazy(() => import('../text/PhoneTitleSheet').then((m) => ({ default: m.PhoneTitleSheet }))),
  export: lazy(() => import('../export/PhoneExportSheet').then((m) => ({ default: m.PhoneExportSheet }))),
};

export function isPhoneSheetId(value: string | null): value is PhoneSheetId {
  return value !== null && Object.prototype.hasOwnProperty.call(PHONE_SHEET_REGISTRY, value);
}
