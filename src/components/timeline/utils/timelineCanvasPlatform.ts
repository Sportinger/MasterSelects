// Platform capability gate for the timeline clip canvas.
//
// On Linux with open-source Mesa drivers (RADV/radeonsi/NVK/llvmpipe), GPU-backed
// 2D canvases are unreliable in ways that silently blank the timeline lanes:
//   - an OffscreenCanvas driven from a worker fails to composite its placeholder
//     element for taller lanes, and
//   - an accelerated main-thread canvas loses its contents when the window is
//     minimized/restored and is only repainted on the next interaction.
// Rendering the clip canvas on a CPU (software) raster avoids both: software
// canvases composite like any bitmap and keep their contents across visibility
// changes. We therefore prefer the main-thread, `willReadFrequently` path on
// Linux. Windows/macOS keep the faster GPU-accelerated worker path.
//
// Detection mirrors WebGPUContext.shouldUseLowPowerFallback so the two Linux
// workarounds stay consistent.
//
// Full reference (failure modes + rules for all canvas/GPU code):
// docs/Features/Linux-Mesa-GPU.md. Issues: #259 (timeline blank), #46
// (importExternalTexture). Do not scatter ad hoc navigator.platform checks —
// route platform decisions through this helper.
let cached: boolean | null = null;

export function prefersSoftwareTimelineCanvas(): boolean {
  if (cached !== null) return cached;
  if (typeof navigator === 'undefined') {
    cached = false;
    return cached;
  }
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  cached = /linux/i.test(platform) && !/android/i.test(navigator.userAgent || '');
  return cached;
}
