import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleManageEditableHook,
  handleRefineEditableHook,
} from '../../src/services/aiTools/handlers/editableHook';
import { handleGetKeyframes } from '../../src/services/aiTools/handlers/keyframes';
import { resolveEditableHookLayerMetadata } from '../../src/services/aiTools/editableHookIdentity';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import { executeAITool } from '../../src/services/aiTools';
import { getToolPolicy } from '../../src/services/aiTools/policy/registry';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
} from '../../src/stores/historyStore';
import { useMediaStore, type Composition } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
let mediaState: ReturnType<typeof useMediaStore.getState>;
let compositionSequence = 0;

function getHookClips(hookId: string): TimelineClip[] {
  for (const composition of mediaState.compositions) {
    const clips = composition.id === mediaState.activeCompositionId
      ? useTimelineStore.getState().clips
      : (composition.timelineData?.clips as TimelineClip[] | undefined) ?? [];
    const matches = clips.filter((clip) => clip.editableHook?.id === hookId);
    if (matches.length > 0) return matches;
  }
  return [];
}

async function openHookComposition(hookId: string): Promise<void> {
  const composition = mediaState.compositions.find((candidate) => (
    candidate.timelineData?.clips.some((clip) => clip.editableHook?.id === hookId)
  ));
  if (!composition) throw new Error(`Hook composition not found: ${hookId}`);
  await mediaState.openCompositionTab(composition.id, { skipAnimation: true });
}

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
    compositionSequence = 0;
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
    const setMediaState = (update: unknown) => {
      const partial = typeof update === 'function'
        ? (update as (state: typeof mediaState) => Partial<typeof mediaState>)(mediaState)
        : update as Partial<typeof mediaState>;
      mediaState = { ...mediaState, ...partial };
    };
    const createComposition = (name: string, settings?: Partial<Composition>): Composition => {
      compositionSequence += 1;
      const created: Composition = {
        id: `hook-subcomposition-${compositionSequence}`,
        name,
        type: 'composition',
        parentId: settings?.parentId ?? null,
        createdAt: compositionSequence + 1,
        width: settings?.width ?? 1080,
        height: settings?.height ?? 1920,
        frameRate: settings?.frameRate ?? 30,
        duration: settings?.duration ?? 30,
        backgroundColor: settings?.backgroundColor ?? '#000000',
        timelineData: settings?.timelineData,
      };
      mediaState = {
        ...mediaState,
        compositions: [...mediaState.compositions, created],
      };
      return created;
    };
    const openCompositionTab = async (id: string) => {
      const currentId = mediaState.activeCompositionId;
      if (currentId && currentId !== id) {
        const timelineData = useTimelineStore.getState().getSerializableState();
        mediaState = {
          ...mediaState,
          compositions: mediaState.compositions.map((candidate) => (
            candidate.id === currentId ? { ...candidate, timelineData } : candidate
          )),
        };
      }
      const target = mediaState.compositions.find((candidate) => candidate.id === id);
      if (!target) throw new Error(`Composition not found: ${id}`);
      mediaState = {
        ...mediaState,
        activeCompositionId: id,
        openCompositionIds: mediaState.openCompositionIds.includes(id)
          ? mediaState.openCompositionIds
          : [...mediaState.openCompositionIds, id],
      };
      await useTimelineStore.getState().loadState(target.timelineData);
    };
    mediaState = {
      ...initialMediaState,
      compositions: [composition],
      activeCompositionId: composition.id,
      openCompositionIds: [composition.id],
      createComposition,
      openCompositionTab,
      getActiveComposition: () => composition,
    } as ReturnType<typeof useMediaStore.getState>;
    mediaState.getActiveComposition = () => (
      mediaState.compositions.find((candidate) => candidate.id === mediaState.activeCompositionId) ?? null
    );
    vi.mocked(useMediaStore.getState).mockImplementation(() => mediaState);
    vi.mocked(useMediaStore.setState).mockImplementation(setMediaState as never);
    resetTimeline();
    setHistoryDisabledForDebug(false);
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    initHistoryStoreRefs({
      timeline: {
        getState: useTimelineStore.getState,
        setState: useTimelineStore.setState,
      },
      media: {
        getState: useMediaStore.getState,
        setState: useMediaStore.setState,
      },
      dock: {
        getState: () => ({ layout: null }),
        setState: () => undefined,
      },
    });
    getHistoryStateView().clearHistory();
  });

  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
    vi.mocked(useMediaStore.setState).mockReset();
    if (getHistoryStateView().batchId !== null) getHistoryStateView().cancelBatch();
    getHistoryStateView().clearHistory();
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
    const wrappers = useTimelineStore.getState().clips.filter(
      (clip) => clip.linkedGroupId === 'hook-recruiting-1' && clip.isComposition,
    );
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0]?.startTime).toBe(3);
    const hookClips = getHookClips('hook-recruiting-1');
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
    const updatedHookClips = getHookClips('hook-recruiting-1');
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
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === wrappers[0]?.id)?.duration).toBe(6);

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

  it('compiles entrance, readable hold, and exit into native layer keyframes', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-native-motion-1',
      preset: 'lower-third',
      startTime: 5,
      duration: 4,
      rows: [
        { text: 'MARIA HOFFMANN' },
        { text: 'CREATIVE DIRECTOR', fontSize: 48 },
      ],
      motion: {
        entrance: {
          direction: 'from-right',
          duration: 0.6,
          overshoot: 24,
          easing: 'ease-out',
        },
        exit: {
          direction: 'to-right',
          duration: 0.5,
          distance: 540,
          easing: 'ease-in',
        },
      },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    expect(created.data).toMatchObject({
      action: 'created',
      hookId: 'hook-native-motion-1',
      motion: {
        holdDuration: 2.9,
        entrance: { direction: 'from-right', duration: 0.6, overshoot: 24 },
        exit: { direction: 'to-right', duration: 0.5, distance: 540 },
      },
    });
    await openHookComposition('hook-native-motion-1');
    const clips = getHookClips('hook-native-motion-1');
    expect(clips).toHaveLength(4);
    expect(clips.every((clip) => clip.parentClipId === undefined)).toBe(true);

    for (const clip of clips) {
      const result = await handleGetKeyframes({ clipId: clip.id }, useTimelineStore.getState());
      expect(result.success, JSON.stringify(result)).toBe(true);
      const keyframes = (result.data as {
        keyframes: Array<{ property: string; time: number; value: number }>;
      }).keyframes;
      expect(keyframes).toEqual(expect.arrayContaining([
        expect.objectContaining({ property: 'opacity', time: 0, value: 0 }),
        expect.objectContaining({ property: 'opacity', time: 0.6, value: 1 }),
        expect.objectContaining({ property: 'opacity', time: 3.5, value: 1 }),
        expect.objectContaining({ property: 'opacity', time: 4, value: 0 }),
      ]));
      const horizontal = keyframes.filter((keyframe) => keyframe.property === 'position.x');
      const start = horizontal.find((keyframe) => keyframe.time === 0)!;
      const settled = horizontal.find((keyframe) => keyframe.time === 0.6)!;
      const exit = horizontal.find((keyframe) => keyframe.time === 4)!;
      expect(start.value - settled.value).toBeCloseTo(1080);
      expect(exit.value - settled.value).toBeCloseTo(540);
    }
  });

  it('rejects motion programs without a readable hold before creating clips', async () => {
    const result = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-motion-no-hold',
      duration: 1,
      rows: [{ text: 'TOO FAST' }],
      motion: {
        entrance: { direction: 'from-right', duration: 0.4 },
        exit: { direction: 'to-right', duration: 0.3 },
      },
    }, useTimelineStore.getState());

    expect(result).toEqual({
      success: false,
      error: 'motion requires at least 0.5 seconds of readable hold time',
    });
    expect(useTimelineStore.getState().clips).toHaveLength(0);
  });

  it('publishes the whole animated hook as exactly one undo step', async () => {
    const result = await executeAITool('manageEditableHook', {
      requestJson: JSON.stringify({
        action: 'create',
        duration: 4,
        hookId: 'hook-one-undo',
        preset: 'lower-third',
        rows: [{ text: 'ONE UNDO' }],
        motion: {
          entrance: { direction: 'from-right', duration: 0.5, overshoot: 18 },
          exit: { direction: 'fade', duration: 0.4 },
        },
      }),
    }, 'kernel', { guidedReplay: false });

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(getHistoryStateView().undoStack).toHaveLength(1);
    expect(
      useTimelineStore.getState().clips,
      JSON.stringify(useTimelineStore.getState().clips.map((clip) => ({
        id: clip.id,
        name: clip.name,
        isComposition: clip.isComposition,
        compositionId: clip.compositionId,
        editableHook: clip.editableHook,
      }))),
    ).toHaveLength(1);
    expect(mediaState.compositions).toHaveLength(2);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(mediaState.compositions).toHaveLength(1);
    expect(getHistoryStateView().undo()).toBeNull();
  });

  it('uses composition pixels for hook typography and geometry', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-pixels-1',
      rows: [{ text: 'PIXELS', fontSize: 96 }],
      style: { cornerRadius: 38.4, paddingX: 32.4, paddingY: 19.2 },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const hookClips = getHookClips('hook-pixels-1');
    const textClip = hookClips.find((clip) => clip.textProperties);
    const backplate = hookClips.find((clip) => clip.motion?.shape?.primitive === 'rectangle');
    expect(textClip?.textProperties?.fontSize).toBe(96);
    expect(backplate?.motion?.shape?.cornerRadius).toBeCloseTo(38.4);
    expect(backplate?.motion?.shape?.size.w).toBeCloseTo(0.76 * 1080 + 2 * 32.4);
    expect(backplate?.motion?.shape?.size.h).toBeCloseTo(0.1 * 1920 + 2 * 19.2);
  });

  it('uses touching banners with centered non-wrapping text by default', async () => {
    const hookId = 'hook-default-layout';
    const created = await handleManageEditableHook({
      action: 'create',
      hookId,
      preset: 'stacked-center',
      rows: [
        { text: 'ONE CENTERED BANNER LINE' },
        { text: 'SECOND CENTERED BANNER LINE' },
      ],
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const clips = getHookClips(hookId);
    const rows = [0, 1].map((rowIndex) => ({
      text: clips.find((clip) => (
        clip.editableHook?.role === 'text' && clip.editableHook.rowIndex === rowIndex
      ))!,
      backplate: clips.find((clip) => (
        clip.editableHook?.role === 'background' && clip.editableHook.rowIndex === rowIndex
      ))!,
    }));
    expect(rows.every((row) => (
      row.text.textProperties?.textAlign === 'center'
      && row.text.textProperties.verticalAlign === 'middle'
      && row.text.textProperties.wrapMode === 'none'
    ))).toBe(true);

    const firstBox = rows[0]!.text.textProperties!;
    const secondBox = rows[1]!.text.textProperties!;
    const firstCenter = firstBox.boxY! + firstBox.boxHeight! / 2;
    const secondCenter = secondBox.boxY! + secondBox.boxHeight! / 2;
    const firstHeight = rows[0]!.backplate.motion!.shape!.size.h;
    const secondHeight = rows[1]!.backplate.motion!.shape!.size.h;
    const visibleGap = secondCenter - secondHeight / 2 - (firstCenter + firstHeight / 2);
    expect(visibleGap).toBeCloseTo(0);
  });

  it('keeps the authored gap between finished backplate edges', async () => {
    const hookId = 'hook-visible-row-gap';
    const created = await handleManageEditableHook({
      action: 'create',
      hookId,
      rows: [
        { text: 'FRISEUR:INNEN' },
        { text: 'IN MÜNCHEN GESUCHT' },
      ],
      placement: { x: 86.4, y: 115.2, width: 940, rowHeight: 118, gap: 14 },
      style: { paddingY: 18 },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const getRows = () => {
      const clips = getHookClips(hookId);
      return [0, 1].map((rowIndex) => ({
        text: clips.find((clip) => (
          clip.editableHook?.role === 'text' && clip.editableHook.rowIndex === rowIndex
        ))!,
        backplate: clips.find((clip) => (
          clip.editableHook?.role === 'background' && clip.editableHook.rowIndex === rowIndex
        ))!,
      }));
    };
    const visibleGap = (rows: ReturnType<typeof getRows>) => {
      const firstBox = rows[0]!.text.textProperties!;
      const secondBox = rows[1]!.text.textProperties!;
      const firstHeight = rows[0]!.backplate.motion!.shape!.size.h;
      const secondHeight = rows[1]!.backplate.motion!.shape!.size.h;
      const firstCenter = firstBox.boxY! + firstBox.boxHeight! / 2;
      const secondCenter = secondBox.boxY! + secondBox.boxHeight! / 2;
      return secondCenter - secondHeight / 2 - (firstCenter + firstHeight / 2);
    };

    const createdRows = getRows();
    expect(createdRows[1]!.text.textProperties?.boxY).toBeCloseTo(283.2);
    expect(visibleGap(createdRows)).toBeCloseTo(14);

    const updated = await handleManageEditableHook({
      action: 'update',
      hookId,
      style: { paddingY: 30 },
    }, useTimelineStore.getState());

    expect(updated.success, JSON.stringify(updated)).toBe(true);
    const updatedRows = getRows();
    expect(updatedRows.every((row) => row.backplate.motion?.shape?.size.h === 178)).toBe(true);
    expect(visibleGap(updatedRows)).toBeCloseTo(14);
  });

  it('uses Arial when the requested font family is unusable', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-font-fallback-1',
      rows: [{ text: 'SAFE FONT' }],
      style: { fontFamily: '   ' },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const textClip = getHookClips('hook-font-fallback-1').find((clip) => clip.textProperties);
    expect(textClip?.textProperties?.fontFamily).toBe('Arial');
  });

  it('uses an explicit pixel left edge for placement', async () => {
    const created = await handleManageEditableHook({
      action: 'create',
      hookId: 'hook-centered-1',
      rows: [{ text: 'CENTERED' }],
      placement: { x: 183.6, y: 384, width: 712.8 },
    }, useTimelineStore.getState());

    expect(created.success, JSON.stringify(created)).toBe(true);
    const textClip = getHookClips('hook-centered-1').find((clip) => clip.textProperties);
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
    const rows = getHookClips('hook-refine-1');
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

    await openHookComposition('hook-original-id');

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

    await openHookComposition(hookId);

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
