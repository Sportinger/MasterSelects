// Phones open the phone editor (/m) instead of the desktop editor. Tablets and desktops keep the
// desktop editor with its automatic Mobile/Medium dock layouts. A phone user who chose the full
// editor keeps it until they switch back with the Mobile toggle.

import { hasEditorOverride, isEditorPath, resolveEntryExperience } from './entryExperience';

/** Phones have a short screen side below this many CSS pixels; tablets and unfolded foldables do not. */
export const PHONE_SHORT_SIDE_MAX_PX = 600;
export const PHONE_EDITOR_PATH = '/m';
export const FULL_EDITOR_PATH = '/editor';
const FULL_EDITOR_PREFERENCE_KEY = 'ms.phoneEditor.preferFullEditor';

export interface PhoneEntryEnvironment {
  /** Primary pointer is a finger (`(pointer: coarse)`). */
  coarsePointer: boolean;
  screenWidth: number;
  screenHeight: number;
  /** The user chose the full editor on this phone. */
  prefersFullEditor: boolean;
}

interface PhoneEntryLocationLike {
  hostname: string;
  pathname: string;
  search?: string;
  hash?: string;
}

export function isPhoneSizedTouchDevice(env: Pick<PhoneEntryEnvironment, 'coarsePointer' | 'screenWidth' | 'screenHeight'>): boolean {
  const shortSide = Math.min(env.screenWidth, env.screenHeight);
  return env.coarsePointer && shortSide > 0 && shortSide < PHONE_SHORT_SIDE_MAX_PX;
}

/**
 * Where a phone should go instead of the desktop editor, or null to stay. Only plain editor entries
 * (`/`, `/editor`) move; `?test`, `?entry=editor`, /medium, /chat and every other page stay as they are.
 */
export function resolvePhoneEntryRedirect(
  locationLike: PhoneEntryLocationLike,
  env: PhoneEntryEnvironment,
): string | null {
  if (env.prefersFullEditor || !isPhoneSizedTouchDevice(env)) return null;
  if (hasEditorOverride(locationLike.search)) return null;
  if (resolveEntryExperience(locationLike) !== 'editor') return null;
  // Deep links below /editor (/editor/…) keep their meaning; only the editor entry itself moves.
  if (isEditorPath(locationLike.pathname) && locationLike.pathname.replace(/\/+$/, '') !== FULL_EDITOR_PATH) {
    return null;
  }
  return `${PHONE_EDITOR_PATH}${locationLike.search ?? ''}${locationLike.hash ?? ''}`;
}

function readFullEditorPreference(): boolean {
  try {
    return window.localStorage.getItem(FULL_EDITOR_PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember (or forget) that this device wants the full editor instead of the phone editor. */
export function rememberFullEditorPreference(prefersFullEditor: boolean): void {
  try {
    if (prefersFullEditor) {
      window.localStorage.setItem(FULL_EDITOR_PREFERENCE_KEY, '1');
    } else {
      window.localStorage.removeItem(FULL_EDITOR_PREFERENCE_KEY);
    }
  } catch {
    // Without storage the choice lasts for this page only; the redirect then applies again next time.
  }
}

export function readPhoneEntryEnvironment(): PhoneEntryEnvironment {
  const coarsePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return {
    coarsePointer,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    prefersFullEditor: readFullEditorPreference(),
  };
}

/** Leave the phone editor for the desktop editor and keep that choice on this device. */
export function openFullEditorFromPhone(): void {
  rememberFullEditorPreference(true);
  window.location.assign(FULL_EDITOR_PATH);
}
