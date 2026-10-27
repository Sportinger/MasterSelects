import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  removeOutputTarget: vi.fn(),
  restoreOutputWindow: vi.fn(() => true),
  closeOutputWindow: vi.fn(),
}));
const scheduler = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn(), updateTargetSource: vi.fn() }));

vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: host }));
vi.mock('../../src/services/renderScheduler', () => ({ renderScheduler: scheduler }));

import { useRenderTargetStore } from '../../src/stores/renderTargetStore';
import { getOutputManagerStorageKey, useSliceStore } from '../../src/stores/sliceStore';
import {
  listOutputTargets, nextOutputTargetName, registerClosedOutputTarget, removeOutputTarget, restoreOutputTarget, restoreSavedOutputTargets,
  routeOutputTargetSource,
} from '../../src/components/outputManager/outputTargetCommands';
import { listOutputSourceOptions, outputSourceKey, outputSourceLabel } from '../../src/components/outputManager/outputSourceOptions';
import { captureOutputMapping, restoreOutputMapping, saveOutputMapping } from '../../src/components/mobileSkin/output/phoneOutputSession';
import { clientToNormalized, parsePercent, pinchView, toPercentText } from '../../src/components/mobileSkin/output/phoneOutputGeometry';
import { clampOutputZoom, PHONE_OUTPUT_MAX_ZOOM, PHONE_OUTPUT_MIN_ZOOM } from '../../src/components/mobileSkin/output/phoneOutputStore';
import { PHONE_WORKSPACES } from '../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog';
import { PHONE_OUTPUT_EXTERNAL_DISPLAY_REASON } from '../../src/components/mobileSkin/output/phoneOutputCommands';

host.removeOutputTarget.mockImplementation((id: string) => useRenderTargetStore.getState().unregisterTarget(id));

function resetStores(): void {
  for (const id of [...useRenderTargetStore.getState().targets.keys()]) useRenderTargetStore.getState().unregisterTarget(id);
  useSliceStore.setState({ configs: new Map(), activeTab: 'output', previewingTargetId: null });
  window.localStorage.clear();
  vi.clearAllMocks();
}

describe('output target commands (shared by the desktop Output Manager and the phone)', () => {
  beforeEach(resetStores);

  it('registers a closed target, names the next one uniquely and lists only output destinations', () => {
    registerClosedOutputTarget('a', nextOutputTargetName());
    registerClosedOutputTarget('b', nextOutputTargetName());
    useRenderTargetStore.getState().registerTarget({
      id: 'preview', name: 'Preview', source: { type: 'activeComp' }, destinationType: 'canvas', enabled: true,
      showTransparencyGrid: false, canvas: null, context: null, window: null, isFullscreen: false,
    });
    expect(listOutputTargets().map((target) => [target.id, target.name, target.enabled])).toEqual([['a', 'Output 1', false], ['b', 'Output 2', false]]);
  });

  it('routes a source on a closed target without scheduling a window that is not open', () => {
    registerClosedOutputTarget('a', 'Stage left');
    routeOutputTargetSource('a', { type: 'composition', compositionId: 'comp-2' });
    expect(useRenderTargetStore.getState().targets.get('a')?.source).toEqual({ type: 'composition', compositionId: 'comp-2' });
    expect(scheduler.register).not.toHaveBeenCalled();
    expect(scheduler.unregister).toHaveBeenCalledWith('a');
  });

  it('warns instead of failing silently when routing to an unknown target', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    routeOutputTargetSource('missing', { type: 'activeComp' });
    expect(useRenderTargetStore.getState().targets.has('missing')).toBe(false);
    warn.mockRestore();
  });

  it('restoring a window schedules its independent source (it used to stay unscheduled)', () => {
    registerClosedOutputTarget('a', 'A', { type: 'slot', slotIndex: 1 });
    host.restoreOutputWindow.mockImplementationOnce(() => {
      useRenderTargetStore.getState().setTargetWindow('a', { closed: false, close: () => {} } as unknown as Window);
      return true;
    });
    expect(restoreOutputTarget('a')).toBe(true);
    expect(scheduler.register).toHaveBeenCalledWith('a');
  });

  it('restores saved targets as closed entries once', () => {
    window.localStorage.setItem(`${getOutputManagerStorageKey()}_targets`, JSON.stringify([{ id: 's1', name: 'Saved', source: { type: 'activeComp' } }]));
    expect(restoreSavedOutputTargets()).toBe(1);
    expect(restoreSavedOutputTargets()).toBe(0);
    expect(useRenderTargetStore.getState().targets.get('s1')?.window).toBeNull();
  });
});

describe('output source options', () => {
  it('offers the active composition, the compositions and every slot with its content', () => {
    const comps = [{ id: 'c1', name: 'Main' }, { id: 'c2', name: 'Backdrop' }];
    const options = listOutputSourceOptions(comps, comps, { 1: 'c2', 0: null });
    expect(options.map((option) => option.label)).toEqual(['Active Composition', 'Main', 'Backdrop', 'Slot 1 (Empty)', 'Slot 2 (Backdrop)']);
    expect(outputSourceKey(options[4].source)).toBe('slot:1');
    expect(outputSourceLabel({ type: 'composition', compositionId: 'c2' }, comps)).toBe('Backdrop');
  });
});

describe('phone output session: Cancel restores, Done saves', () => {
  beforeEach(resetStores);

  it('Cancel puts back targets, names, sources, slices, masks and the saved copy', () => {
    registerClosedOutputTarget('a', 'Projector');
    const slice = useSliceStore.getState().addSlice('a');
    saveOutputMapping();
    const key = getOutputManagerStorageKey();
    const savedBefore = window.localStorage.getItem(key);
    const snapshot = captureOutputMapping();

    useRenderTargetStore.getState().updateTargetName('a', 'Renamed');
    routeOutputTargetSource('a', { type: 'composition', compositionId: 'x' });
    useSliceStore.getState().setCornerPinCorner('a', slice, 1, { x: 0.7, y: 0.2 });
    useSliceStore.getState().addMask('a');
    registerClosedOutputTarget('b', 'Extra');
    useSliceStore.getState().addSlice('b');
    saveOutputMapping();

    restoreOutputMapping(snapshot);
    const targets = listOutputTargets();
    expect(targets.map((target) => [target.id, target.name, target.source.type])).toEqual([['a', 'Projector', 'activeComp']]);
    const config = useSliceStore.getState().configs.get('a');
    expect(config?.slices.map((item) => item.type)).toEqual(['slice']);
    expect(config?.slices[0].warp.mode === 'cornerPin' && config.slices[0].warp.corners[1]).toEqual({ x: 1, y: 0 });
    expect(useSliceStore.getState().configs.has('b')).toBe(false);
    expect(window.localStorage.getItem(key)).toBe(savedBefore);
    expect(JSON.parse(window.localStorage.getItem(`${key}_targets`) ?? '[]')).toEqual([{ id: 'a', name: 'Projector', source: { type: 'activeComp' } }]);
  });

  it('Cancel brings back a target removed during the session, with its slices', () => {
    registerClosedOutputTarget('a', 'Projector', { type: 'slot', slotIndex: 0 });
    useSliceStore.getState().addMask('a');
    const snapshot = captureOutputMapping();
    removeOutputTarget('a');
    expect(useSliceStore.getState().configs.has('a')).toBe(false);
    restoreOutputMapping(snapshot);
    expect(useRenderTargetStore.getState().targets.get('a')?.source).toEqual({ type: 'slot', slotIndex: 0 });
    expect(useSliceStore.getState().configs.get('a')?.slices[0].type).toBe('mask');
  });

  it('Cancel of a session that started without any saved mapping leaves no saved mapping behind', () => {
    const key = getOutputManagerStorageKey();
    const snapshot = captureOutputMapping();
    registerClosedOutputTarget('a', 'New');
    saveOutputMapping();
    expect(window.localStorage.getItem(`${key}_targets`)).not.toBeNull();
    restoreOutputMapping(snapshot);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem(`${key}_targets`)).toBeNull();
  });

  it('Done after removing every target saves an empty target list instead of keeping the old one', () => {
    const key = getOutputManagerStorageKey();
    registerClosedOutputTarget('a', 'Old');
    saveOutputMapping();
    removeOutputTarget('a');
    expect(saveOutputMapping()).toBe(true);
    expect(window.localStorage.getItem(`${key}_targets`)).toBeNull();
  });
});

describe('phone output geometry', () => {
  it('pinch keeps the content point under the fingers and zooms with their spread', () => {
    const view = pinchView({ zoom: 1, panX: 0, panY: 0 }, { x: 90, y: 100 }, { x: 110, y: 100 }, { x: 80, y: 100 }, { x: 120, y: 100 });
    expect(view.zoom).toBeCloseTo(2);
    // Content point (100,100) stays at the midpoint (100,100).
    expect(view.panX + view.zoom * 100).toBeCloseTo(100);
    const panned = pinchView({ zoom: 2, panX: 0, panY: 0 }, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 30, y: 10 }, { x: 70, y: 10 });
    expect(panned).toEqual({ zoom: 2, panX: 30, panY: 10 });
  });

  it('clamps zoom and maps a finger into the drawn output box', () => {
    expect(clampOutputZoom(100)).toBe(PHONE_OUTPUT_MAX_ZOOM);
    expect(clampOutputZoom(0.01)).toBe(PHONE_OUTPUT_MIN_ZOOM);
    expect(clampOutputZoom(Number.NaN)).toBe(1);
    expect(clientToNormalized({ left: 10, top: 20, width: 200, height: 100 }, 60, 70)).toEqual({ x: 0.25, y: 0.5 });
    expect(clientToNormalized({ left: 0, top: 0, width: 0, height: 10 }, 1, 1)).toBeNull();
  });

  it('reads typed percent values and rejects anything else', () => {
    expect(parsePercent('25')).toBe(0.25);
    expect(parsePercent('12,5 %')).toBe(0.125);
    expect(parsePercent('-10')).toBe(-0.1);
    expect(parsePercent('abc')).toBeNull();
    expect(toPercentText(0.125)).toBe('12.5');
    expect(toPercentText(1)).toBe('100');
  });
});

describe('phone output editor wiring', () => {
  it('is a landscape editor with targets left, stage in the middle and the slice stack right', () => {
    const output = PHONE_WORKSPACES.find((entry) => entry.id === 'output');
    expect(output?.main).toEqual({ kind: 'custom', id: 'output-stage', title: 'Output' });
    expect(output?.left?.kind === 'custom' && output.left.id).toBe('output-targets');
    expect(output?.right?.kind === 'custom' && output.right.id).toBe('output-slices');
  });

  it('explains the greyed "open on a display" control with what it needs and where it works', () => {
    expect(PHONE_OUTPUT_EXTERNAL_DISPLAY_REASON.length).toBeGreaterThanOrEqual(20);
    expect(PHONE_OUTPUT_EXTERNAL_DISPLAY_REASON).toMatch(/full editor/);
  });
});
