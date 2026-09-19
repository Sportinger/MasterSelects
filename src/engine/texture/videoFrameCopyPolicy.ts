type NavigatorPlatformInfo = Pick<Navigator, 'userAgent'> & {
  userAgentData?: { platform?: string };
};

export function isAndroidVideoFrameRuntime(
  runtimeNavigator: NavigatorPlatformInfo | undefined =
    typeof navigator === 'undefined' ? undefined : navigator
): boolean {
  if (!runtimeNavigator) return false;
  const platform = runtimeNavigator.userAgentData?.platform ?? '';
  return /android/i.test(`${platform} ${runtimeNavigator.userAgent}`);
}

export function shouldStageHtmlVideoFrame(video: HTMLVideoElement): boolean {
  return isAndroidVideoFrameRuntime() && (video.paused || video.seeking);
}

/** Android Chromium playback is more stable through persistent copied textures. */
export function shouldCopyHtmlVideoPreviewFrame(
  runtimeNavigator: NavigatorPlatformInfo | undefined =
    typeof navigator === 'undefined' ? undefined : navigator
): boolean {
  return isAndroidVideoFrameRuntime(runtimeNavigator);
}
