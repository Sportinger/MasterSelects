import { FencedRecordStreamParser, hasOnlyKeys, type FencedStreamFormat, type FencedStreamRejection } from '../nodeGraph/fencedRecordStream';
import { NODE_GRAPH_STREAM_TOOLS } from '../nodeGraph/nodeGraphStream';

/**
 * Scene streams (ms-scene-v1): a named, re-runnable block of editor tool records that builds
 * a piece of a timeline (tracks, clips, figures, keys, effects, sound). The scene owns every
 * track, clip and marker its records create; running the scene again removes those first and
 * rebuilds them, so a scene is edited by changing its text and re-running it.
 */
export const SCENE_STREAM_TOOLS = [
  // Tracks
  'createTrack', 'renameTrack', 'setTrackVisibility', 'setTrackMuted',
  // Clips with their own content
  'createSolidClip', 'createMidiClip', 'createTextClip', 'updateTextProperties', 'setTextBox', 'addTextBoundsKeyframe',
  'createCaptionClip', 'updateCaptionProperties', 'addCompositionClip',
  // Motion Design
  'createMotionShapeClip', 'updateMotionProperties', 'updateMotionAppearances', 'applyMotionAppearancePreset',
  'applyMotionTemplate', 'createMotionNull', 'createMotionNullAndParent', 'setMotionParent',
  'configureMotionReplicator', 'editMotionModifier', 'setMotionExpression', 'editMotionAdjustment',
  // Clip editing
  'moveClip', 'trimClip', 'splitClip', 'setClipSpeed', 'setTransform', 'addTransition', 'addMarker',
  // Keys, effects and masks
  'addKeyframe', 'removeKeyframe', 'addEffect', 'updateEffect', 'removeEffect',
  'addMask', 'addRectangleMask', 'addEllipseMask', 'updateMask', 'addMaskPathKeyframe', 'addVertex', 'updateVertex',
  // Stick figure rigs
  'createRig', 'addActionClip', 'setActionTarget',
  // Flock clips and image node graphs
  'createFlockClip', 'applyFlockPreset', 'exposeFlockParam',
  ...NODE_GRAPH_STREAM_TOOLS.filter(tool => !['addEffect', 'updateEffect', 'removeEffect', 'addKeyframe'].includes(tool)),
] as const;

const SCENE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.:-]{0,79}$/u;

export const SCENE_STREAM_PROTOCOL = {
  schemaVersion: 1, fence: 'ms-scene-v1',
  purpose: 'Build or rebuild a named part of the timeline. Running a scene again first removes every track, clip and marker its previous run created, then executes the records again, as one undo step. Edit a scene by changing its text and re-running it.',
  framing: 'JSON object records inside the exact fenced block, one per line recommended. Records execute in order. Several scene blocks (and ms-nodegraph-v1 blocks) may follow each other.',
  begin: { op: 'begin', schemaVersion: 1, scene: '<scene name, e.g. "Part 2 - Fight">', compositionId: '<optional; default: the scene\'s previous composition, else the active one>', replace: true },
  operation: { op: 'tool', seq: 1, ref: 'uniqueAlias', tool: '<allowed tool>', args: {} },
  end: { op: 'end', lastSeq: 1 },
  fields: 'seq and lastSeq count from 1 per block. ref is a unique alias (letters, digits, _ or -) for the record\'s result; it defaults to s<seq>. Unlike ms-nodegraph-v1, args carry clipId/trackId explicitly, usually as result references.',
  resultReference: { $ref: '<earlier alias>', field: '<top-level result field: trackId, clipId, effectId, figure, nodeId, markerId...>' },
  example: [
    '{"op":"begin","schemaVersion":1,"scene":"Intro"}',
    '{"op":"tool","seq":1,"ref":"fx","tool":"createTrack","args":{"type":"video","name":"Intro FX"}}',
    '{"op":"tool","seq":2,"ref":"hero","tool":"createRig","args":{"trackId":{"$ref":"fx","field":"trackId"},"start":0,"duration":4,"params":{"scale":0.8}}}',
    '{"op":"tool","seq":3,"ref":"walk","tool":"addActionClip","args":{"figure":{"$ref":"hero","field":"figure"},"action":"walk","start":0.2,"duration":2}}',
    '{"op":"tool","seq":4,"tool":"addKeyframe","args":{"clipId":{"$ref":"hero","field":"clipId"},"keys":{"opacity":[[0,0],[0.4,1,"ease-out"]]}}}',
    '{"op":"end","lastSeq":4}',
  ],
  allowedTools: SCENE_STREAM_TOOLS,
  ownership: 'Only tracks, clips and markers created by the scene\'s records are owned and replaced. Edits a scene makes to clips it did not create are not undone by a re-run.',
  execution: 'Through the dev bridge (runEditorStream) the whole text is validated first; nothing runs if any record is malformed or not allowed. Then records run in order through normal editor policy; a failed record is reported and later records continue (references to it fail). The scene text and what it created are stored in a project document "Scene: <name>".',
} as const;

export type SceneStreamRecord =
  | { op: 'begin'; schemaVersion: 1; scene: string; compositionId?: string; replace: boolean }
  | { op: 'tool'; seq: number; ref: string; tool: string; args: Record<string, unknown> }
  | { op: 'end'; lastSeq: number };

export type SceneStreamRejection = FencedStreamRejection;

export const SCENE_STREAM_FORMAT: FencedStreamFormat = {
  fence: 'ms-scene-v1',
  label: 'Scene stream',
  allowedTools: SCENE_STREAM_TOOLS,
  aliasField: 'ref',
  forbiddenArgKeys: [],
  invalidOperation: 'Invalid scene operation, sequence or alias.',
  begin: value => {
    if (value.op !== 'begin' || value.schemaVersion !== 1 || !hasOnlyKeys(value, ['op', 'schemaVersion', 'scene', 'compositionId', 'replace'])) {
      return { error: 'Scene stream must begin with {"op":"begin","schemaVersion":1,"scene":"<name>"} (optional compositionId, replace).' };
    }
    if (typeof value.scene !== 'string' || !SCENE_NAME.test(value.scene.trim())) {
      return { error: 'Scene name must be 1-80 letters, digits, spaces or _ . : - and start with a letter or digit.' };
    }
    if (value.compositionId !== undefined && (typeof value.compositionId !== 'string' || !value.compositionId)) return { error: 'compositionId must be a string.' };
    if (value.replace !== undefined && typeof value.replace !== 'boolean') return { error: 'replace must be true or false.' };
    return { record: { op: 'begin', schemaVersion: 1, scene: value.scene.trim(),
      ...(value.compositionId ? { compositionId: value.compositionId as string } : {}), replace: value.replace !== false } };
  },
};

export class SceneStreamParser extends FencedRecordStreamParser<SceneStreamRecord> {
  constructor(receive: (record: SceneStreamRecord) => void, onRejected?: (rejection: SceneStreamRejection) => void) {
    super(SCENE_STREAM_FORMAT, receive, onRejected);
  }
}

/** Canonical text of one scene block (stored with the scene and used to re-run it). */
export function formatSceneStream(records: readonly SceneStreamRecord[]): string {
  const lines = records.map(record => JSON.stringify(record.op === 'begin'
    ? { op: 'begin', schemaVersion: 1, scene: record.scene, ...(record.compositionId ? { compositionId: record.compositionId } : {}),
      ...(record.replace ? {} : { replace: false }) }
    : record));
  return ['```' + SCENE_STREAM_FORMAT.fence, ...lines, '```'].join('\n');
}
