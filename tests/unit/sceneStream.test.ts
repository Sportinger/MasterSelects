import { afterEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useDocumentsStore } from '../../src/stores/documentsStore';
import { executeAITool } from '../../src/services/aiTools';
import { AI_TOOLS } from '../../src/services/aiTools/definitions';
import { getToolPolicy } from '../../src/services/aiTools/policy';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import { SCENE_STREAM_TOOLS, SceneStreamParser, formatSceneStream } from '../../src/services/scenes/sceneStream';
import { SceneStreamExecutor } from '../../src/services/scenes/sceneStreamExecutor';
import { collapseNodeStreamBlocks } from '../../src/components/panels/flashboard/nodeStreamDisplay';
import { parseEditorStream } from '../../src/services/aiTools/handlers/editorStream';
import { loadSceneRegistry, readSceneStream } from '../../src/services/scenes/sceneDocuments';
import { createMockTrack } from '../helpers/mockData';

const initialTimeline = useTimelineStore.getState();
const initialDocuments = useDocumentsStore.getState();
afterEach(() => {
  useTimelineStore.setState(initialTimeline);
  useDocumentsStore.setState(initialDocuments);
});

const scene = (name: string, records: unknown[]) => [
  '```ms-scene-v1',
  JSON.stringify({ op: 'begin', schemaVersion: 1, scene: name }),
  ...records.map((record, index) => JSON.stringify({ op: 'tool', seq: index + 1, ...(record as object) })),
  JSON.stringify({ op: 'end', lastSeq: records.length }),
  '```',
].join('\n');

const INTRO = scene('Intro', [
  { ref: 'fx', tool: 'createTrack', args: { type: 'video', name: 'Intro FX' } },
  { ref: 'bg', tool: 'createSolidClip', args: { trackId: { $ref: 'fx', field: 'trackId' }, start: 0, duration: 3, color: '#102030', name: 'BG' } },
  { ref: 'fade', tool: 'addKeyframe', args: { clipId: { $ref: 'bg', field: 'clipId' }, keys: { opacity: [[0, 0], [0.5, 1, 'ease-out']] } } },
  { ref: 'sfx', tool: 'createTrack', args: { type: 'midi', name: 'SFX', instrument: 'sfx-hit' } },
  { ref: 'hits', tool: 'createMidiClip', args: { trackId: { $ref: 'sfx', field: 'trackId' }, start: 1, notes: [{ time: 0, pitch: 48 }, { time: 0.5, pitch: 52, velocity: 0.6 }] } },
  { ref: 'mark', tool: 'addMarker', args: { time: 1, label: 'hit' } },
]);

describe('scene stream format', () => {
  it('only allows real, policy-registered tools', () => {
    const names = new Set(AI_TOOLS.map(tool => tool.function.name));
    for (const tool of SCENE_STREAM_TOOLS) {
      expect(names.has(tool), tool).toBe(true);
      expect(getToolPolicy(tool), tool).toBeTruthy();
    }
    for (const tool of ['createSolidClip', 'createMidiClip', 'runEditorStream', 'listScenes']) expect(getToolPolicy(tool), tool).toBeTruthy();
    expect(MODIFYING_TOOLS.has('runEditorStream')).toBe(true);
  });

  it('parses interleaved scene and node blocks in text order', () => {
    const text = [
      'prose before',
      scene('A', [{ ref: 't', tool: 'createTrack', args: { type: 'video' } }]),
      '```ms-nodegraph-v1',
      '{"op":"begin","schemaVersion":1,"clipId":"c1"}',
      '{"op":"tool","seq":1,"ref":"b","tool":"addEffect","args":{"effectType":"brightness"}}',
      '{"op":"end","lastSeq":1}',
      '```',
      scene('B', [{ ref: 't', tool: 'createTrack', args: { type: 'audio' } }]),
    ].join('\n');
    const { records, problems } = parseEditorStream(text);
    expect(problems).toEqual([]);
    expect(records.map(item => `${item.kind}:${item.record.op}`)).toEqual([
      'scene:begin', 'scene:tool', 'scene:end', 'node:begin', 'node:tool', 'node:end', 'scene:begin', 'scene:tool', 'scene:end',
    ]);
  });

  it('collects every problem instead of stopping at the first', () => {
    const text = scene('Bad', [
      { ref: 'a', tool: 'deleteTrack', args: { trackId: 'x' } },
      { ref: 'b', tool: 'createTrack', args: { type: 'video' } },
      { ref: 'b', tool: 'createTrack', args: { type: 'video' } },
    ]);
    const { problems } = parseEditorStream(text);
    expect(problems.join('\n')).toMatch(/seq 1 \(deleteTrack\).*not allowed/);
    expect(problems.join('\n')).toMatch(/seq 3.*duplicate ref alias/);
    expect(parseEditorStream('```ms-scene-v1\n{"op":"begin","schemaVersion":1}\n```').problems[0]).toMatch(/Scene name must be/);
  });

  it('formats a canonical, re-parseable block', () => {
    const text = formatSceneStream([
      { op: 'begin', schemaVersion: 1, scene: 'X', replace: true },
      { op: 'tool', seq: 1, ref: 'a', tool: 'createTrack', args: { type: 'video' } },
      { op: 'end', lastSeq: 1 },
    ]);
    expect(parseEditorStream(text)).toMatchObject({ problems: [], records: [{ kind: 'scene' }, { kind: 'scene' }, { kind: 'scene' }] });
  });
});

describe('runEditorStream', () => {
  const setup = () => useTimelineStore.setState({ tracks: [createMockTrack({ id: 'v0', type: 'video' })], clips: [], markers: [], clipKeyframes: new Map() });

  it('validates first and runs nothing when a record is bad', async () => {
    setup();
    const bad = INTRO.replace('"createMidiClip"', '"deleteClips"');
    const result = await executeAITool('runEditorStream', { text: bad }, 'devBridge');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rejected before running anything/);
    expect(useTimelineStore.getState().tracks).toHaveLength(1);
  });

  it('builds a scene, stores it and replaces it on a re-run', async () => {
    setup();
    const first = await executeAITool('runEditorStream', { text: INTRO }, 'devBridge');
    expect(first.error).toBeUndefined();
    expect(first.success).toBe(true);
    const state = useTimelineStore.getState();
    expect(state.tracks.map(track => track.name)).toEqual(expect.arrayContaining(['Intro FX', 'SFX']));
    const sfx = state.tracks.find(track => track.name === 'SFX')!;
    expect(sfx.type).toBe('midi');
    expect(sfx.midiInstrument).toMatchObject({ kind: 'simple-synth' });
    const midi = state.clips.find(clip => clip.trackId === sfx.id)!;
    expect(midi.midiData?.notes).toHaveLength(2);
    const bg = state.clips.find(clip => clip.name === 'BG')!;
    expect(state.clipKeyframes.get(bg.id)?.filter(key => key.property === 'opacity')).toHaveLength(2);
    expect(state.markers).toHaveLength(1);

    const registry = loadSceneRegistry('Intro')!;
    expect(registry.entries.flatMap(entry => entry.clips).sort()).toEqual([bg.id, midi.id].sort());
    expect(readSceneStream('Intro')).toContain('"createMidiClip"');

    // Re-run the stored scene: the old entities are replaced, nothing accumulates.
    const again = await executeAITool('runEditorStream', { scene: 'Intro' }, 'devBridge');
    expect(again.success).toBe(true);
    const rebuilt = useTimelineStore.getState();
    expect(rebuilt.tracks).toHaveLength(3);
    expect(rebuilt.clips).toHaveLength(2);
    expect(rebuilt.markers).toHaveLength(1);
    expect(rebuilt.clips.some(clip => clip.id === bg.id)).toBe(false);
    expect((again.data as { scenes: { removed: { clips: string[] } }[] }).scenes[0].removed.clips).toHaveLength(2);
    expect(useDocumentsStore.getState().documents.filter(doc => doc.title === 'Scene: Intro')).toHaveLength(1);
  });

  it('reports failed records and keeps the rest', async () => {
    setup();
    const text = scene('Partial', [
      { ref: 't', tool: 'createTrack', args: { type: 'video', name: 'P' } },
      { ref: 'bad', tool: 'createSolidClip', args: { trackId: { $ref: 't', field: 'trackId' }, color: 'red' } },
      { ref: 'ok', tool: 'createSolidClip', args: { trackId: { $ref: 't', field: 'trackId' }, blank: true } },
      { ref: 'ref', tool: 'addKeyframe', args: { clipId: { $ref: 'bad', field: 'clipId' }, keys: { opacity: [[0, 1]] } } },
    ]);
    const result = await executeAITool('runEditorStream', { text }, 'devBridge');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^2\/4 records ran/);
    expect(result.error).toMatch(/color must be/);
    expect(result.error).toMatch(/no successful record "bad"/);
    expect(useTimelineStore.getState().clips).toHaveLength(1);
  });
});

describe('live scene streaming (FlashBoard text deltas)', () => {
  it('runs each record as soon as its closing brace arrives, before the text is complete', async () => {
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'v0', type: 'video' })], clips: [], markers: [], clipKeyframes: new Map() });
    const executor = new SceneStreamExecutor((tool, args) => executeAITool(tool, args, 'devBridge'));
    let queue: Promise<unknown> = Promise.resolve();
    const parser = new SceneStreamParser(record => { queue = queue.then(() => executor.accept(record)); });
    const firstRecordEnd = INTRO.indexOf('"Intro FX"}}') + '"Intro FX"}}'.length;
    for (let index = 0; index < firstRecordEnd; index += 7) parser.push(INTRO.slice(index, Math.min(index + 7, firstRecordEnd)));
    await queue;
    expect(useTimelineStore.getState().tracks.some(track => track.name === 'Intro FX')).toBe(true);
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    for (let index = firstRecordEnd; index < INTRO.length; index += 7) parser.push(INTRO.slice(index, index + 7));
    parser.push('\n');
    parser.finish();
    await queue;
    expect(executor.failures).toEqual([]);
    expect(useTimelineStore.getState().clips).toHaveLength(2);
    expect(loadSceneRegistry('Intro')?.entries.length).toBeGreaterThan(0);
  });

  it('shows a streamed scene as one chat line', () => {
    expect(collapseNodeStreamBlocks(`Los:\n${INTRO}\nFertig.`)).toBe('Los:\n[Szene „Intro“: 6 Schritte]\nFertig.');
    expect(collapseNodeStreamBlocks('```ms-scene-v1\n{"op":"begin","schemaVersion":1,"scene":"Fight"}\n{"op":"tool"'))
      .toBe('[Szene „Fight“ läuft: 1 Schritte …]');
  });
});

describe('createRig params', () => {
  it('applies valid figure parameters and rejects unknown ones', async () => {
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'v0', type: 'video' })], clips: [], clipKeyframes: new Map() });
    const ok = await executeAITool('createRig', { start: 0, params: { scale: 0.5, groundMode: 'plant', turn: -1 } }, 'devBridge');
    expect(ok.success).toBe(true);
    const effect = useTimelineStore.getState().clips[0].effects[0];
    expect(effect.params).toMatchObject({ scale: 0.5, turn: -1 });
    const bad = await executeAITool('createRig', { params: { scal: 2 } }, 'devBridge');
    expect(bad.error).toMatch(/Unknown stick figure parameter: scal/);
    const hidden = await executeAITool('createRig', { params: { actions: '[]' } }, 'devBridge');
    expect(hidden.success).toBe(false);
  });
});
