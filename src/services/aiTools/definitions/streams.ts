import type { ToolDefinition } from '../types';

export const streamToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'runEditorStream',
      description: 'Run fenced editor stream blocks in one call: ```ms-scene-v1 (named, re-runnable timeline scenes: tracks, clips, rigs, keys, effects, MIDI) and ```ms-nodegraph-v1 (node graph of one clip). The whole text is validated first; nothing runs if any record is malformed or not allowed. Then records run in order as one undo step; failed records are reported and later ones continue. Re-running a scene first removes everything its previous run created. Pass scene instead of text to re-run a stored scene (see listScenes).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One or more fenced blocks. Scene: ```ms-scene-v1 / {"op":"begin","schemaVersion":1,"scene":"Name"} / {"op":"tool","seq":1,"ref":"a","tool":"createTrack","args":{...}} / ... / {"op":"end","lastSeq":N} / ```. Reference earlier results with {"$ref":"a","field":"trackId"}.' },
          scene: { type: 'string', description: 'Re-run the stored scene with this name (its project document "Scene: <name>").' },
          dryRun: { type: 'boolean', description: 'Only validate and count records.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getStreamProtocol',
      description: 'Read the full record format and allowed tools of an editor stream before writing one: ms-scene-v1 (timeline scenes) or ms-nodegraph-v1 (node graph of one clip).',
      parameters: {
        type: 'object',
        properties: { format: { type: 'string', enum: ['ms-scene-v1', 'ms-nodegraph-v1'], description: 'Stream format.' } },
        required: ['format'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listScenes',
      description: 'List stored scene streams with their document, composition and how many tracks and clips their last run created.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
