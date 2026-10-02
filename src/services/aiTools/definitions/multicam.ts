// Multicam Tool Definitions

import type { ToolDefinition } from '../types';

export const multicamToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'syncClipsViaAudio',
      description: 'Synchronize timeline clips by their audio (waveform cross-correlation), like "Sync via audio" in the clip menu. Matched clips move to their synced start times together with their linked video and share one linked group; one undo step. Pass video clips or audio clips; video clips sync through their linked audio. Hour-long stems and camera files are read streamed; camera formats without browser audio (MXF) first get their audio proxy, which can take minutes. Runs as a background job: returns the finished result or, while running, jobId with progress and ETA for getAudioSyncStatus.',
      parameters: {
        type: 'object',
        properties: {
          clipIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            description: 'Timeline clip IDs to synchronize (from getTimelineState).',
          },
          masterClipId: {
            type: 'string',
            description: 'Reference clip that stays in place; one of clipIds. Default: the longest clip, which overlaps the most material (for example a wide shot or a recorder running through every take).',
          },
          minConfidence: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Weakest match that is applied; weaker matches are reported in failures and left in place. Default: medium.',
          },
          waitMs: {
            type: 'number',
            minimum: 0,
            maximum: 240000,
            description: 'How long to wait for the result before returning the running job. Default: 15000.',
          },
        },
        required: ['clipIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAudioSyncStatus',
      description: 'Wait for and read an audio sync job started by syncClipsViaAudio: progress, phase, current clip and ETA while running; aligned clips with new start times and confidence, plus failures, when done.',
      parameters: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'jobId returned by syncClipsViaAudio.',
          },
          waitMs: {
            type: 'number',
            minimum: 0,
            maximum: 240000,
            description: 'Wait up to this long for the job to finish before returning. Default: 60000.',
          },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setMulticamMode',
      description: 'Turn the active composition into a multicam edit, or switch its multicam cut mode on/off. Enabling for the first time makes every video track with plain video clips one camera angle (top track = key 1) and builds the program from the topmost camera with material at each moment; audio clips stay and are linked. Place one camera per video track and sync the clips first.',
      parameters: {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'true builds or re-activates the multicam edit; false turns cut mode off and keeps the program clips.',
          },
        },
        required: ['enabled'],
      },
    },
  },
];
