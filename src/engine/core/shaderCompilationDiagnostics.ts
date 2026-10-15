import { Logger } from '../../services/logger';

/** Best-effort diagnostics must never turn device loss into an unhandled rejection.
 * Pipeline creation/validation still owns shader failures; this only reports them.
 */
export async function reportShaderCompilation(
  module: GPUShaderModule,
  component: string,
  label: string,
  source?: string,
): Promise<void> {
  const log = Logger.create(component);
  try {
    if (!module.getCompilationInfo) {
      log.warn(`Shader compilation diagnostics unavailable for ${label}`);
      return;
    }
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) {
      const lines = source?.split(/\r?\n/);
      log.error(`Shader compilation failed for ${label}`, errors.map(message => {
        const location = `${message.lineNum}:${message.linePos} ${message.message}`;
        return lines ? `${location} | ${lines[message.lineNum - 1]?.trim() ?? ''}` : location;
      }));
    }
  } catch (error) {
    // The diagnostic query itself can reject when its GPU instance disappears.
    // Retain the reason and owning shader without emitting a second runtime error.
    log.warn(`Shader compilation diagnostics unavailable for ${label}`, error);
  }
}
