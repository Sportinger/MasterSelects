import type { ToolDefinition } from '../types';

const sceneStatus = {
  type: 'string',
  enum: ['draft', 'ready', 'gathering', 'generating', 'review', 'accepted', 'filled', 'blocked'],
  description: 'Current scene-card workflow status.',
};

const editableSceneProperties: Record<string, unknown> = {
  title: { type: 'string', description: 'Short scene-card title.' },
  description: { type: 'string', description: 'What happens in the scene.' },
  intent: { type: 'string', description: 'Narrative intent.' },
  visualDirection: { type: 'string', description: 'Visual direction.' },
  audioDirection: { type: 'string', description: 'Audio direction.' },
  transitionIntent: { type: 'string', description: 'Transition intent.' },
  sceneKind: { type: 'string', description: 'Optional scene category.' },
  beatId: { type: 'string', description: 'Optional narrative beat ID.' },
  color: { type: 'string', description: 'Card color as a CSS hex color.' },
  targetDurationSeconds: { type: 'number', description: 'Desired scene duration in seconds, greater than zero.' },
  status: sceneStatus,
  notes: { type: 'string', description: 'Internal scene notes.' },
};

const timelineFragmentDefinition: Record<string, unknown> = {
  type: 'object',
  description: 'Portable, range-local timeline fragment. Times are offsets from the selected range start.',
  properties: {
    schemaVersion: { type: 'number', enum: [1] },
    durationSeconds: { type: 'number', description: 'Positive duration no longer than the selected range.' },
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localTrackId: { type: 'string' },
          sourceTrackId: { type: 'string' },
          kind: { type: 'string', enum: ['video', 'audio'] },
        },
        required: ['localTrackId', 'sourceTrackId', 'kind'],
      },
    },
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          localId: { type: 'string' },
          sourceClipId: { type: 'string' },
          localTrackId: { type: 'string' },
          startOffsetSeconds: { type: 'number' },
          durationSeconds: { type: 'number' },
          payload: {
            type: 'object',
            description: 'JSON-safe clip properties; identity and placement are remapped at materialization.',
          },
        },
        required: [
          'localId',
          'localTrackId',
          'startOffsetSeconds',
          'durationSeconds',
          'payload',
        ],
      },
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fromClipId: { type: 'string' },
          toClipId: { type: 'string' },
        },
        required: ['fromClipId', 'toClipId'],
      },
    },
    keyframes: { type: 'array', items: { type: 'object' } },
    effects: { type: 'array', items: { type: 'object' } },
    masks: { type: 'array', items: { type: 'object' } },
    transitions: { type: 'array', items: { type: 'object' } },
    markers: { type: 'array', items: { type: 'object' } },
    annotations: { type: 'array', items: { type: 'object' } },
    sceneIds: { type: 'array', items: { type: 'string' } },
    candidateIds: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'schemaVersion',
    'durationSeconds',
    'tracks',
    'clips',
    'links',
    'keyframes',
    'effects',
    'masks',
    'transitions',
    'markers',
    'annotations',
    'sceneIds',
    'candidateIds',
    'warnings',
  ],
};

export const storyboardToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'addStoryboardScene',
      description: 'Add a persistent storyboard scene card to an unlocked video track.',
      parameters: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Unlocked video track ID. Defaults to the first available video track.' },
          startTime: { type: 'number', description: 'Timeline start in seconds. Defaults to the playhead.' },
          planId: { type: 'string', description: 'Storyboard plan ID. Uses the default plan when omitted.' },
          durationSeconds: { type: 'number', description: 'Actual timeline duration in seconds, greater than zero.' },
          ...editableSceneProperties,
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateStoryboardScene',
      description: 'Update every timeline card that projects the same stable storyboard scene ID.',
      parameters: {
        type: 'object',
        properties: {
          sceneId: { type: 'string', description: 'Stable storyboard scene ID.' },
          ...editableSceneProperties,
        },
        required: ['sceneId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listStoryboardScenes',
      description: 'List storyboard scene cards in timeline order, optionally filtered by plan ID.',
      parameters: {
        type: 'object',
        properties: {
          planId: { type: 'string', description: 'Optional storyboard plan ID.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createTimelineVariantSet',
      description: 'Freeze the painted timeline range as the immutable base for exactly three storyboard alternatives.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Human-readable comparison title.' },
          sceneIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Storyboard scene IDs represented by the selected range.',
          },
          includeLinked: {
            type: 'boolean',
            description: 'Include linked clips when capturing the range. Defaults to true.',
          },
          id: { type: 'string', description: 'Optional stable set ID.' },
        },
        required: ['title', 'sceneIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addTimelineVariantOption',
      description: 'Attach one portable planned option to a range variant set. A set accepts exactly three options.',
      parameters: {
        type: 'object',
        properties: {
          variantSetId: { type: 'string' },
          option: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              rationale: { type: 'string' },
              state: {
                type: 'string',
                enum: ['planned', 'building', 'ready', 'failed', 'rejected', 'accepted'],
              },
              fragment: timelineFragmentDefinition,
              candidateIds: { type: 'array', items: { type: 'string' } },
              lineage: { type: 'object' },
            },
            required: ['title', 'rationale', 'state', 'fragment', 'candidateIds'],
          },
        },
        required: ['variantSetId', 'option'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'materializeTimelineVariantOption',
      description: 'Build an isolated temporary composition for one of the three registered options without changing the base edit.',
      parameters: {
        type: 'object',
        properties: {
          optionId: { type: 'string' },
        },
        required: ['optionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listTimelineVariantOptions',
      description: 'List a timeline variant set and its three portable options without changing editor state.',
      parameters: {
        type: 'object',
        properties: {
          variantSetId: { type: 'string' },
        },
        required: ['variantSetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'commitTimelineVariantOption',
      description: 'Atomically replace only the frozen base range with a selected option after stale fingerprint validation.',
      parameters: {
        type: 'object',
        properties: {
          optionId: { type: 'string' },
          boundaryPolicy: {
            type: 'string',
            enum: ['preserve', 'rebuild', 'drop-with-warning'],
            description: 'How transitions crossing the range boundary are handled. Defaults to preserve.',
          },
        },
        required: ['optionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'archiveTimelineVariantSet',
      description: 'Archive an uncommitted timeline variant comparison without changing the base edit.',
      parameters: {
        type: 'object',
        properties: {
          variantSetId: { type: 'string' },
        },
        required: ['variantSetId'],
      },
    },
  },
];
