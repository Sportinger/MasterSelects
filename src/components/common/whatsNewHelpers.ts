import { BUILD_NOTICE, type ChangelogNotice as ChangelogNoticeConfig } from '../../version';
import type { NativeHelperPublishedRelease } from '../../services/nativeHelper/releases';

export function getHelperBuildNotice(
  publishedRelease: NativeHelperPublishedRelease | null,
): ChangelogNoticeConfig | null {
  if (!BUILD_NOTICE) {
    return null;
  }

  const notice: ChangelogNoticeConfig = {
    ...BUILD_NOTICE,
  };

  if (publishedRelease && !notice.link) {
    notice.link = {
      label: `Native Helper v${publishedRelease.version}`,
      href: publishedRelease.url,
    };
  }

  return notice;
}
