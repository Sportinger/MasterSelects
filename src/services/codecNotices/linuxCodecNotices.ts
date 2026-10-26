import { Logger } from '../logger';
import { getRuntimeDeviceContext } from '../../utils/runtimeDeviceContext';
import { useUiSettingsStore } from '../../stores/uiSettingsStore';
import { useLinuxCodecNoticeStore } from '../../stores/linuxCodecNoticeStore';
import {
  getLinuxCodecNoticeMessage,
  shouldShowLinuxCodecNotice,
  type LinuxCodecNoticeContext,
  type LinuxCodecNoticeId,
} from './linuxCodecNoticePolicy';

const log = Logger.create('LinuxCodecNotice');
const loggedNotices = new Set<LinuxCodecNoticeId>();

/** Platform gate for UI that only changes behavior where the notices can appear. */
export function isLinuxCodecNoticePlatform(): boolean {
  return getRuntimeDeviceContext().platform === 'linux';
}

export function isLinuxCodecNoticeDismissed(id: LinuxCodecNoticeId): boolean {
  const dismissed = useUiSettingsStore.getState().dismissedCodecNotices;
  return Array.isArray(dismissed) && dismissed.includes(id);
}

/**
 * Report the result of a real browser capability check (isConfigSupported
 * with the config actually used). Shows the dismissible banner on Linux when
 * the browser said no, and logs the fallback once per session, also after
 * the user dismissed the banner. Returns whether the banner is shown.
 */
export function reportLinuxCodecSupport(
  id: LinuxCodecNoticeId,
  supported: boolean | null | undefined,
  context: LinuxCodecNoticeContext = {},
): boolean {
  const { platform } = getRuntimeDeviceContext();
  if (platform === 'linux' && supported === false && !loggedNotices.has(id)) {
    loggedNotices.add(id);
    const message = getLinuxCodecNoticeMessage(id, context);
    log.warn(`${message.title} ${message.body}`, { id, ...context });
  }
  const show = shouldShowLinuxCodecNotice({ platform, supported, dismissed: isLinuxCodecNoticeDismissed(id) });
  if (show) useLinuxCodecNoticeStore.getState().show({ id, context });
  return show;
}

/** The condition that raised the notice no longer applies; nothing is remembered. */
export function withdrawLinuxCodecNotice(id: LinuxCodecNoticeId): void {
  useLinuxCodecNoticeStore.getState().hide(id);
}

/** The user closed the notice: it stays closed, also after a reload. */
export function dismissLinuxCodecNotice(id: LinuxCodecNoticeId): void {
  useUiSettingsStore.getState().dismissCodecNotice(id);
  useLinuxCodecNoticeStore.getState().hide(id);
}

export function resetLinuxCodecNoticeLogForTests(): void {
  loggedNotices.clear();
}
