// Output target commands shared by the desktop Output Manager window and the phone output editor.
// One implementation of target lifecycle and source routing; both UIs call these.

import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { getSavedTargetMeta } from '../../stores/sliceStore';
import { renderScheduler } from '../../services/renderScheduler';
import { renderHostPort } from '../../services/render/renderHostPort';
import { Logger } from '../../services/logger';
import type { RenderSource, RenderTarget } from '../../types/renderTarget';

const log = Logger.create('OutputTargets');

/** Output targets are the window/tab destinations the Output Manager lists (not preview canvases). */
export function isOutputTarget(target: Pick<RenderTarget, 'destinationType'>): boolean {
  return target.destinationType === 'window' || target.destinationType === 'tab';
}

/** A target whose output window is not open (closed, never opened, or restored from a save). */
export function isOutputTargetClosed(target: Pick<RenderTarget, 'window'>): boolean {
  return target.window === null || target.window === undefined || target.window.closed;
}

export function listOutputTargets(targets: Map<string, RenderTarget> = useRenderTargetStore.getState().targets): RenderTarget[] {
  return [...targets.values()].filter(isOutputTarget);
}

/** The scheduler renders independent sources (anything but the active composition) of open targets. */
function syncScheduler(targetId: string): void {
  const target = useRenderTargetStore.getState().targets.get(targetId);
  if (!target || isOutputTargetClosed(target) || target.source.type === 'activeComp') {
    renderScheduler.unregister(targetId);
    return;
  }
  renderScheduler.register(targetId);
  renderScheduler.updateTargetSource(targetId);
}

/** Routes a composition, slot or the active composition to an output target. */
export function routeOutputTargetSource(targetId: string, source: RenderSource): void {
  const store = useRenderTargetStore.getState();
  if (!store.targets.has(targetId)) {
    log.warn(`Cannot route a source to unknown output target "${targetId}"`);
    return;
  }
  store.updateTargetSource(targetId, source);
  syncScheduler(targetId);
}

/**
 * Registers an output target without opening its window (the "closed" state the Output Manager shows
 * with Restore). Used for targets restored from a save and for targets built on a device that cannot
 * open a second window (the phone): the mapping is configured and saved now, the window opens later.
 */
export function registerClosedOutputTarget(
  id: string,
  name: string,
  source: RenderSource = { type: 'activeComp' },
  isFullscreen = false,
): void {
  useRenderTargetStore.getState().registerTarget({
    id,
    name,
    source,
    destinationType: 'window',
    enabled: false,
    showTransparencyGrid: false,
    canvas: null,
    context: null,
    window: null,
    isFullscreen,
  });
}

/** Restores saved targets that are not registered yet as closed entries (Output Manager on open). */
export function restoreSavedOutputTargets(): number {
  const store = useRenderTargetStore.getState();
  let restored = 0;
  for (const saved of getSavedTargetMeta()) {
    if (store.targets.has(saved.id)) continue;
    registerClosedOutputTarget(saved.id, saved.name, saved.source, saved.isFullscreen ?? false);
    restored++;
  }
  return restored;
}

/** Opens the output window of a closed target again; an independent source starts rendering in it. */
export function restoreOutputTarget(targetId: string): boolean {
  const restored = renderHostPort.restoreOutputWindow(targetId);
  if (!restored) {
    log.warn(`Could not open the output window of "${targetId}" (popup blocked or no engine)`);
    return false;
  }
  syncScheduler(targetId);
  return true;
}

export function closeOutputTarget(targetId: string): void {
  renderScheduler.unregister(targetId);
  renderHostPort.closeOutputWindow(targetId);
}

export function removeOutputTarget(targetId: string): void {
  renderScheduler.unregister(targetId);
  renderHostPort.removeOutputTarget(targetId);
}

/** A display name "Output N" that no existing output target uses yet. */
export function nextOutputTargetName(targets: Map<string, RenderTarget> = useRenderTargetStore.getState().targets): string {
  const names = new Set(listOutputTargets(targets).map((target) => target.name));
  let index = names.size + 1;
  while (names.has(`Output ${index}`)) index++;
  return `Output ${index}`;
}
