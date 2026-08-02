import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleManageEditableHook,
  handleRefineEditableHook,
} from '../../src/services/aiTools/handlers/editableHook';
import { resolveEditableHookLayerMetadata } from '../../src/services/aiTools/editableHookIdentity';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import { getToolPolicy } from '../../src/services/aiTools/policy/registry';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [{
      id: 'video-1',
      name: 'Video 1',
      type: 'video',
      height: 70,
      muted: false,
      visible: true,
      solo: false,
    }],
    playheadPosition: 2,
    clipKeyframes: new Map(),
  });
}

describe('manageEditableHook', () => {
  beforeEach(() => {
    useMediaStore.setState(initialMediaState);
    const composition: Composition = {
      id: 'hook-composition',
      name: 'Hook Test',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1080,
      height: 1920,
      frameRate: 30,
      duration: 30,
      backgroundColor: '#000000',
    };
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      compositions: [composition],
      activeCompositionId: composition.id,
      getActiveComposition: () => composition,
    } as ReturnType<typeof useMediaStore.getState>);
    resetTimeline();
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
  });

  it('is a kernel-authorized medium-risk modifying tool', () => {
    expect(getRegisteredToolHandlerNames()).toContain('manageEditableHook');
    expect(getRegisteredToolHandlerNames()).toContain('refineEditableHook');
    expect(MODIFYING_TOOLS.has('manageEditableHook')).toBe(true);
    expect(MODIFYING_TOOLS.has('refineEditableHook')).toBe(true);
    expect(getToolPolicy('manageEditableHook')).toMatchObject({
      allowedCallers: expect.arrayContaining(['kernel']),
      readOnly: false,
      requiresConfirmation: false,
      riskLevel: 'medium',
    });
    expect(getToolPolicy('refineEditableHook')).toMatchObject({
      allowedCallers: expect.arrayContaining(['kernel']),
      readOnly: false,
      requiresConfirmation: false,
      riskLevel: 'medium',
    });
  });

  it('creates one durable editable hook and updates it in place', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-recruiting-1',
      preset: 'stacked-center',
      startTime: 3,
      duration: 5,
      rows: [
        { text: 'WIR SUCHEN DICH', backgroundColor: '#111111' },
        { text: 'JETZT BEWERBEN', backgroundColor: '#f0c400', textColor: '#111111' },
      ],
      style: { fontWeight: 900, cornerRadius: 24 },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const hookClips = useTimelineStore.getState().clips.filter(
      (clip) => clip.linkedGroupId === 'hook-recruiting-1',
    );
    expect(hookClips).toHaveLength(4);
    expect(hookClips.filter((clip) => clip.textProperties)).toHaveLength(2);
    expect(hookClips.filter((clip) => clip.motion?.shape?.primitive === 'rectangle')).toHaveLength(2);

    const updated = await handleManageEditableHook({
      action: 'update',
      hookId: 'hook-recruiting-1',
      preset: 'lower-third',
      duration: 6,
      rows: [
        { text: 'DEIN NEUER JOB', backgroundColor: '#7a20ff' },
        { text: 'IN MÜNCHEN', backgroundColor: '#7a20ff', textColor: '#ffffff' },
      ],
      style: { fontFamily: 'Arial', fontSize: 76, backgroundOpacity: 1 },
    }, useTimelineStore.getState());

    expect(updated.success, JSON.stringify(updated)).toBe(true);
    const updatedHookClips = useTimelineStore.getState().clips.filter(
      (clip) => clip.linkedGroupId === 'hook-recruiting-1',
    );
    expect(updatedHookClips).toHaveLength(4);
    const textClips = updatedHookClips
      .filter((clip) => clip.textProperties)
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(textClips.map((clip) => clip.textProperties?.text)).toEqual([
      'DEIN NEUER JOB',
      'IN MÜNCHEN',
    ]);
    expect(textClips.every((clip) => clip.duration === 6)).toBe(true);
    expect(textClips.every((clip) => clip.textProperties?.fontSize === 76)).toBe(true);
    expect(textClips[0]?.textProperties?.boxY).toBeCloseTo(0.66 * 1920);

    const fills = updatedHookClips
      .filter((clip) => clip.motion?.shape?.primitive === 'rectangle')
      .map((clip) => clip.motion?.appearance?.items.find((item) => item.kind === 'color-fill'));
    expect(fills.every((fill) => (
      fill
      && 'color' in fill
      && fill.color.r === 122 / 255
      && fill.color.g === 32 / 255
      && fill.color.b === 1
    ))).toBe(true);
  });

  it('accepts the bounded JSON operation payload and rejects duplicate hook ids', async () => {
    const requestJson = JSON.stringify({
      action: 'create',
      hookId: 'hook-json-1',
      preset: 'top-banner',
      rows: [{ text: 'FAST HOOK' }],
    });
    const first = await handleManageEditableHook({ requestJson }, useTimelineStore.getState());
    expect(first.success, JSON.stringify(first)).toBe(true);
    const clipCount = useTimelineStore.getState().clips.length;

    const duplicate = await handleManageEditableHook({ requestJson }, useTimelineStore.getState());
    expect(duplicate).toEqual({ success: false, error: 'Hook already exists: hook-json-1' });
    expect(useTimelineStore.getState().clips).toHaveLength(clipCount);
  });

  it('uses composition pixels for hook typography and geometry', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-pixels-1',
      rows: [{ text: 'PIXELS', fontSize: 96 }],
      style: { cornerRadius: 38.4, paddingX: 32.4, paddingY: 19.2 },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const hookClips = useTimelineStore.getState().clips.filter(
      (clip) => clip.linkedGroupId === 'hook-pixels-1',
    );
    const textClip = hookClips.find((clip) => clip.textProperties);
    const backplate = hookClips.find((clip) => clip.motion?.shape?.primitive === 'rectangle');
    expect(textClip?.textProperties?.fontSize).toBe(96);
    expect(backplate?.motion?.shape?.cornerRadius).toBeCloseTo(38.4);
    expect(backplate?.motion?.shape?.size.w).toBeCloseTo(0.76 * 1080 + 2 * 32.4);
    expect(backplate?.motion?.shape?.size.h).toBeCloseTo(0.1 * 1920 + 2 * 19.2);
  });

  it('uses an explicit pixel left edge for placement', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-centered-1',
      rows: [{ text: 'CENTERED' }],
      placement: { x: 183.6, y: 384, width: 712.8 },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const textClip = useTimelineStore.getState().clips.find(
      (clip) => clip.linkedGroupId === 'hook-centered-1' && clip.textProperties,
    );
    expect(textClip?.textProperties?.boxX).toBeCloseTo(183.6);
  });

  it('refines indexed text and backplate rows without exposing raw clip ids', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-refine-1',
      rows: [{ text: 'FIRST' }, { text: 'SECOND' }],
    }, useTimelineStore.getState());
    expect(created.success, JSON.stringify(created)).toBe(true);

    const refined = await handleRefineEditableHook({
      requestJson: JSON.stringify({
        hookId: 'hook-refine-1',
        textEdits: [{
          rowIndex: 1,
          text: 'ITERATED',
          fontSize: 76.8,
          textColor: '#112233',
          box: { x: 216, width: 648 },
        }],
        backgroundEdits: [{
          rowIndex: 1,
          centerX: 540,
          width: 756,
          cornerRadius: 38.4,
          fillColor: '#fedcba',
          fillOpacity: 0.8,
        }],
      }),
    }, useTimelineStore.getState());

    expect(refined).toMatchObject({
      success: true,
      data: {
        action: 'refined',
        hookId: 'hook-refine-1',
        textRows: [1],
        backgroundRows: [1],
      },
    });
    const rows = useTimelineStore.getState().clips.filter(
      (clip) => clip.linkedGroupId === 'hook-refine-1',
    );
    const text = rows.find((clip) => clip.textProperties?.text === 'ITERATED');
    const background = rows.find((clip) => (
      clip.motion?.shape?.primitive === 'rectangle'
      && clip.motion.shape.size.w === 756
    ));
    expect(text, JSON.stringify(rows.map((clip) => ({
      name: clip.name,
      text: clip.textProperties?.text,
      width: clip.motion?.shape?.size.w,
    })))).toBeDefined();
    expect(text?.textProperties).toMatchObject({
      boxWidth: 648,
      boxX: 216,
      color: '#112233',
      fontSize: 76.8,
      text: 'ITERATED',
    });
    expect(background?.motion?.shape?.size.w).toBeCloseTo(756);
    expect(background?.motion?.shape?.cornerRadius).toBeCloseTo(38.4);
    expect(background?.transform?.position.x).toBeCloseTo(0);
    const fill = background?.motion?.appearance?.items.find((item) => item.kind === 'color-fill');
    expect(fill).toMatchObject({ opacity: 0.8 });
  });

  it('recovers legacy named hook rows and adopts a durable identity on refinement', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-original-id',
      rows: [{ text: 'FIRST' }, { text: 'SECOND' }],
    }, useTimelineStore.getState());
    expect(created.success, JSON.stringify(created)).toBe(true);

    useTimelineStore.setState((state) => ({
      clips: state.clips.map((clip) => ({
        ...clip,
        name: clip.editableHook?.role === 'text' && clip.editableHook.rowIndex === 1
          ? 'SECOND'
          : clip.name,
        editableHook: undefined,
        linkedGroupId: undefined,
      })),
    }));
    const recovered = resolveEditableHookLayerMetadata(
      useTimelineStore.getState().clips,
      useTimelineStore.getState().tracks,
    );
    const recoveredIds = new Set([...recovered.values()].map((identity) => identity.id));
    expect(recoveredIds.size).toBe(1);
    const recoveredHookId = [...recoveredIds][0]!;
    expect(recoveredHookId).toMatch(/^hook-legacy-[a-f0-9]{16}$/);

    const refined = await handleRefineEditableHook({
      hookId: recoveredHookId,
      textEdits: [{ rowIndex: 0, textColor: '#000000' }],
      backgroundEdits: [{ rowIndex: 0, fillColor: '#ffffff' }],
    }, useTimelineStore.getState());

    expect(refined.success, JSON.stringify(refined)).toBe(true);
    const adopted = useTimelineStore.getState().clips.filter(
      (clip) => clip.editableHook?.id === recoveredHookId,
    );
    expect(adopted).toHaveLength(4);
    expect(adopted.map((clip) => clip.editableHook)).toEqual(expect.arrayContaining([
      { id: recoveredHookId, role: 'text', rowIndex: 0 },
      { id: recoveredHookId, role: 'background', rowIndex: 0 },
      { id: recoveredHookId, role: 'text', rowIndex: 1 },
      { id: recoveredHookId, role: 'background', rowIndex: 1 },
    ]));
  });

  it('recovers text rows when only the backplates retain the durable hook group', async () => {
    const hookId = 'hook-partial-metadata';
    const created = await handleManageEditableHook({
      action: 'create',
      hookId,
      rows: [{ text: 'FIRST' }, { text: 'SECOND' }],
    }, useTimelineStore.getState());
    expect(created.success, JSON.stringify(created)).toBe(true);

    useTimelineStore.setState((state) => ({
      clips: state.clips.map((clip) => ({
        ...clip,
        name: clip.editableHook?.role === 'text' && clip.editableHook.rowIndex === 1
          ? 'SECOND'
          : clip.name,
        editableHook: undefined,
        linkedGroupId: clip.textProperties ? undefined : clip.linkedGroupId,
      })),
    }));
    const recovered = resolveEditableHookLayerMetadata(
      useTimelineStore.getState().clips,
      useTimelineStore.getState().tracks,
    );
    expect([...recovered.values()]).toHaveLength(4);
    expect([...recovered.values()].every((identity) => identity.id === hookId)).toBe(true);

    const refined = await handleRefineEditableHook({
      hookId,
      textEdits: [{ rowIndex: 0, textColor: '#111111' }],
      backgroundEdits: [{ rowIndex: 0, fillColor: '#ffffff' }],
    }, useTimelineStore.getState());

    expect(refined.success, JSON.stringify(refined)).toBe(true);
    const adopted = useTimelineStore.getState().clips.filter(
      (clip) => clip.editableHook?.id === hookId && clip.linkedGroupId === hookId,
    );
    expect(adopted).toHaveLength(4);
  });
});
