// The legacy "Mobile" dock layout (the H/V Mobile over-layout of the desktop editor) is switched off.
// Owner decision 2026-10-27: the phone editor at /m is the mobile view. The legacy layout kept turning
// itself on (narrow windows, detected mobile devices), so while this switch is off nothing enters it:
// no automatic switching, no manual entry, no settings toggle, and a persisted Mobile layout from an
// earlier session returns to the desktop layout once on load. The code stays so it can come back.
// Turning it on again also needs a manual entry point: the Mobile button now always opens /m.

import type { DockLayout } from '../../types/dock';

export const LEGACY_MOBILE_DOCK_LAYOUT_ENABLED = false;

/** Root split ids of the legacy landscape and portrait Mobile trees (layoutDefaults.ts). */
const LEGACY_MOBILE_ROOT_IDS = new Set(['mobile-root-split', 'mobile-v-root-split']);

/** Whether a dock tree (e.g. one stored in a project) is the legacy Mobile layout. */
export function isLegacyMobileLayoutTree(layout: DockLayout): boolean {
  return LEGACY_MOBILE_ROOT_IDS.has(layout.root.id);
}

let override: boolean | null = null;

export function isLegacyMobileDockLayoutEnabled(): boolean {
  return override ?? LEGACY_MOBILE_DOCK_LAYOUT_ENABLED;
}

/** Tests only: force the switch on or off; `null` returns to the shipped value. */
export function setLegacyMobileDockLayoutEnabledForTests(enabled: boolean | null): void {
  override = enabled;
}
