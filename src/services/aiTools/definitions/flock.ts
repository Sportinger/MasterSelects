import type { ToolDefinition } from '../types';

const portRefSchema = {
  type: 'object',
  properties: {
    nodeId: { type: 'string', description: 'Flock graph node id returned by getFlockClip.' },
    port: { type: 'string', description: 'Port id from listFlockOperators (for example spawn, behavior, particles, scene).' },
  },
  required: ['nodeId', 'port'],
};

const paramsSchema = {
  type: 'object',
  description: 'Node parameter values keyed by parameter id from listFlockOperators. Numbers/integers/booleans/enum strings as scalars, vec3 as [x, y, z], colors as "#rrggbb". Group instances use "<innerNodeId>__<paramId>" keys.',
  additionalProperties: true,
};

export const flockToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'listFlockOperators',
      description: 'List the registered Flock graph operators with typed ports and parameter descriptors (type, default, range, options, animatable, invalidation). Only same-type ports connect; Simulation and Scene Output are required once.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['population', 'behavior', 'guidance', 'selection', 'values', 'simulation', 'render', 'output', 'groups'],
            description: 'Optional category filter.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createFlockClip',
      description: 'Create a native 3D Flock clip (GPU particle swarm driven by an editable node graph) from a built-in preset on an unlocked video track. Presets: free-swarm, krill-cloud, vortex, follow-path, technical-network, shrimp-pullback, violet-filaments. Omitted timing uses the playhead and ten seconds.',
      parameters: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Unlocked video track id. Defaults to the first visible unlocked video track.' },
          startTime: { type: 'number', description: 'Timeline start in seconds. Defaults to the playhead.' },
          duration: { type: 'number', description: 'Clip duration in seconds, greater than 0. Defaults to 10.' },
          presetId: { type: 'string', description: 'Preset id. Defaults to free-swarm.' },
          name: { type: 'string', description: 'Optional clip name.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFlockClip',
      description: 'Read a Flock clip: preset, capacity, graph nodes/edges, exposed controls with their keyframe property paths, compile diagnostics and bounded runtime status (state, alive count, step, memory, cache). Never returns particle arrays. Keyframe paths are flock.node.<nodeId>.<param>[.x|.y|.z|.r|.g|.b] and use simulation source time.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          includeGraph: { type: 'boolean', description: 'Include node parameter values and edge endpoints. Defaults to true.' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'applyFlockPreset',
      description: 'Replace a Flock clip graph with a built-in preset. Removes the clip\'s existing flock parameter keyframes because node ids change.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          presetId: { type: 'string', description: 'Preset id from createFlockClip.' },
        },
        required: ['clipId', 'presetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addFlockNode',
      description: 'Add one operator node to a Flock graph, optionally wiring it in the same atomic step. Every connection is validated (types, single-input occupancy with replacement, no cycles); if any fails nothing is written.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          operator: { type: 'string', description: 'Operator id from listFlockOperators, for example flock.vortex.' },
          params: paramsSchema,
          label: { type: 'string', description: 'Optional node label.' },
          layout: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
            description: 'Optional node position in the Node Workspace.',
          },
          connect: {
            type: 'array',
            maxItems: 16,
            description: 'Connections for the new node. Use {fromNodeId, fromPort, toPort} to feed an input of the new node, or {fromPort, toNodeId, toPort} to connect an output of the new node.',
            items: {
              type: 'object',
              properties: {
                fromNodeId: { type: 'string' },
                fromPort: { type: 'string' },
                toNodeId: { type: 'string' },
                toPort: { type: 'string' },
              },
              required: ['fromPort', 'toPort'],
            },
          },
        },
        required: ['clipId', 'operator'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateFlockNode',
      description: 'Set static parameter values, bypass state or the label of one Flock graph node in one undo step. Structural parameters (counts, seeds, step rate) resimulate from the start; animatable parameters that already have keyframes keep following their keyframes (use addKeyframe with the returned property path).',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          nodeId: { type: 'string', description: 'Node id from getFlockClip.' },
          params: paramsSchema,
          bypassed: { type: 'boolean', description: 'Bypass (mute or pass through) the node when its operator supports it.' },
          label: { type: 'string', description: 'New node label; empty string clears it.' },
        },
        required: ['clipId', 'nodeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeFlockNodes',
      description: 'Remove Flock graph nodes with their edges, exposed controls and parameter keyframes.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          nodeIds: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Node ids to remove.' },
        },
        required: ['clipId', 'nodeIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connectFlockPorts',
      description: 'Connect an output port to an input port in a Flock graph. Occupied single inputs are replaced; repeated inputs (Compose, Merge, Obstacles, Scene Output) keep connection order.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          from: portRefSchema,
          to: portRefSchema,
        },
        required: ['clipId', 'from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disconnectFlockEdge',
      description: 'Remove one edge from a Flock graph.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          edgeId: { type: 'string', description: 'Edge id from getFlockClip.' },
        },
        required: ['clipId', 'edgeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exposeFlockParam',
      description: 'Promote one node parameter to the clip Properties panel. The control binds to the canonical node value and stores no separate value or keyframes.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          nodeId: { type: 'string', description: 'Node id.' },
          param: { type: 'string', description: 'Parameter id.' },
          label: { type: 'string', description: 'Control label.' },
          group: { type: 'string', description: 'Properties group heading.' },
          min: { type: 'number', description: 'Slider minimum.' },
          max: { type: 'number', description: 'Slider maximum.' },
        },
        required: ['clipId', 'nodeId', 'param'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unexposeFlockParam',
      description: 'Remove one exposed control from the clip Properties panel (the node parameter is unchanged).',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          exposedId: { type: 'string', description: 'Exposed control id from getFlockClip.' },
        },
        required: ['clipId', 'exposedId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scheduleFlockPrecompute',
      description: 'Start precomputing a source-time range of a Flock clip for reliable scrubbing, optionally persisting restart checkpoints for a reopened project. Returns immediately; poll getFlockClip runtime.cache.precomputeProgress.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          start: { type: 'number', description: 'Range start in simulation source seconds.' },
          end: { type: 'number', description: 'Range end in simulation source seconds, greater than start.' },
          persist: { type: 'boolean', description: 'Persist checkpoints in the browser cache. Defaults to false.' },
        },
        required: ['clipId', 'start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelFlockPrecompute',
      description: 'Cancel a running Flock precompute for a clip.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sampleFlockParticles',
      description: 'Diagnostics only: read a bounded sample of current particles ([x, y, z, vx, vy, vz, age, group] per particle, simulation units) from the live preview session.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The flock clip id.' },
          maxCount: { type: 'integer', description: 'Particles to sample, 1 to 256. Defaults to 32.' },
        },
        required: ['clipId'],
      },
    },
  },
];
