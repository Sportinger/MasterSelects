/** Linux/Mesa canvas presentation can silently fail despite valid GPU rendering. */
export function prefersSoftwareTimelineCanvas(): boolean {
  if (typeof navigator === 'undefined') return false;
  const info = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = info.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /linux/i.test(platform) && !/android/i.test(`${platform} ${navigator.userAgent || ''}`);
}

export function resetCanvasPlatformPreferenceForTests(): void {
  // Policy reads current browser platform information; there is no cached boot state.
}
