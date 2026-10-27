// Rules of the phone install page: which platform's steps to show and whether the browser offers its
// own install dialog, the app already runs installed, or only the manual steps remain.
import type { AppInstallState } from '../../../services/pwa/appInstallPrompt';

export type PhoneInstallPlatform = 'ios' | 'android' | 'other';
export type PhoneInstallView = 'installed' | 'prompt' | 'steps';

export function phoneInstallPlatform(userAgent: string, maxTouchPoints = 0): PhoneInstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

/** Installed beats an offered prompt; without a prompt the page shows the manual steps. */
export function phoneInstallView(state: AppInstallState): PhoneInstallView {
  if (state.installed) return 'installed';
  return state.canInstall ? 'prompt' : 'steps';
}
