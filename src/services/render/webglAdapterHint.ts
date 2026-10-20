export interface WebGlAdapterHint {
  readonly vendor?: string;
  readonly description?: string;
  readonly source: 'webgl-debug-renderer';
}

/**
 * GPU name as WebGL reports it. Works when WebGPU has no adapter at all, so it
 * is the only GPU identity available for those failures. Firefox returns a
 * sanitized renderer string; Chromium unmasks it through the debug extension.
 */
export function readWebGlDebugAdapterInfo(): WebGlAdapterHint | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) return null;
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info') as {
      readonly UNMASKED_VENDOR_WEBGL: number;
      readonly UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const vendor = debugInfo
      ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? '')
      : String(context.getParameter(context.VENDOR) ?? '');
    const renderer = debugInfo
      ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(context.getParameter(context.RENDERER) ?? '');
    // Release the probe context right away; browsers cap live WebGL contexts.
    const lose = context.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null;
    if (typeof lose?.loseContext === 'function') lose.loseContext();
    const description = [vendor, renderer].filter(Boolean).join(' ');
    return description
      ? { vendor, description, source: 'webgl-debug-renderer' }
      : null;
  } catch {
    return null;
  }
}
