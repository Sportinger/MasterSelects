// Phones open the phone editor (/m) instead of the desktop editor. Tablets and desktops keep the
// desktop editor with its automatic Mobile/Medium dock layouts. A phone user who chose the full
// editor keeps it until they switch back with the Mobile toggle. The installed app (PWA) is scoped to
// /editor and stays there.

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
  /** Running as the installed app (PWA), whose scope is /editor; /m would leave the app window. */
  installedApp: boolean;
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
  if (env.prefersFullEditor || env.installedApp || !isPhoneSizedTouchDevice(env)) return null;
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

/** Remember (or forget) that this device wants the full editor; false when storage is unavailable. */
export function rememberFullEditorPreference(prefersFullEditor: boolean): boolean {
  try {
    if (prefersFullEditor) {
      window.localStorage.setItem(FULL_EDITOR_PREFERENCE_KEY, '1');
    } else {
      window.localStorage.removeItem(FULL_EDITOR_PREFERENCE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function readPhoneEntryEnvironment(): PhoneEntryEnvironment {
  const matches = (query: string) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return {
    coarsePointer: matches('(pointer: coarse)'),
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    prefersFullEditor: readFullEditorPreference(),
    installedApp: matches('(display-mode: standalone)') || matches('(display-mode: fullscreen)')
      || matches('(display-mode: minimal-ui)'),
  };
}

/** Leave the phone editor for the desktop editor and keep that choice on this device. */
export function openFullEditorFromPhone(): void {
  // Without storage the choice cannot be kept; the explicit override still opens the full editor.
  const remembered = rememberFullEditorPreference(true);
  window.location.assign(remembered ? FULL_EDITOR_PATH : `${FULL_EDITOR_PATH}?entry=editor`);
}
