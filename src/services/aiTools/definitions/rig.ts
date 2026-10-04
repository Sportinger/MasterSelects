import type { ToolDefinition } from '../types';
import { SKELETON_ACTION_IDS } from '../../rig/skeletonActions';
import { SKELETON_JOINTS } from '../../rig/skeletonRig';

const figure = { type: 'string', description: 'Stick figure: "clipId|effectId" from createRig/listRigs, or a clip id with one Stick Figure.' };

/** Atomic stick-figure rig tools; choreography orchestration stays with the caller. */
export const rigToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'createRig',
      description: 'Create a stick figure: a transparent Blank clip with a Stick Figure effect. Returns clipId, effectId and the figure reference used by the other rig tools.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Timeline start in seconds (default: playhead).' },
          duration: { type: 'number', description: 'Clip duration in seconds (default 5).' },
          trackId: { type: 'string', description: 'Video track (default: first unlocked video track).' },
          name: { type: 'string', description: 'Clip name.' },
          facing: { type: 'string', enum: ['right', 'left'], description: 'Direction the figure faces.' },
          color: { type: 'string', description: 'Figure color as #rrggbb.' },
          x: { type: 'number', description: 'Pelvis X in figure pixels at a 1080 px frame (0 = centre, e.g. -300 left, 300 right).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addActionClip',
      description: 'Add an action to a stick figure\'s action lane. Actions blend with neighbours, move the figure (walk/run/jump travel) and have a contact moment (impact, release, landing). Times are clip seconds.',
      parameters: {
        type: 'object',
        properties: {
          figure,
          action: { type: 'string', enum: [...SKELETON_ACTION_IDS], description: 'Action to play.' },
          start: { type: 'number', description: 'Start in clip seconds.' },
          duration: { type: 'number', description: 'Duration in seconds (default: the action\'s natural length).' },
          strength: { type: 'number', description: 'How far the pose departs from standing, 0..2 (default 1).' },
          targetFigure: { type: 'string', description: 'Optional figure to aim the strike at ("clipId|effectId").' },
          targetJoint: { type: 'string', enum: [...SKELETON_JOINTS], description: 'Joint of the target figure to hit (default head).' },
        },
        required: ['figure', 'action', 'start'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setActionTarget',
      description: 'Aim a striking action (punch, kick, grab, throw) at a joint of another stick figure, or clear the aim. Around the contact the limb bends toward the target by inverse kinematics.',
      parameters: {
        type: 'object',
        properties: {
          figure,
          actionId: { type: 'string', description: 'Action id from addActionClip or listRigs.' },
          targetFigure: { type: 'string', description: 'Figure to aim at; omit to clear the aim.' },
          targetJoint: { type: 'string', enum: [...SKELETON_JOINTS], description: 'Joint to hit (default head).' },
        },
        required: ['figure', 'actionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listRigs',
      description: 'List the stick figures of the open timeline with their action lanes and contact times.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validateChoreography',
      description: 'Check all stick figures for feet below the ground, strikes that miss, joints that pop between frames, overlapping actions and bodies passing through each other. Returns issues with timeline times.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Timeline start in seconds (default: first figure).' },
          end: { type: 'number', description: 'Timeline end in seconds (default: last figure).' },
          fps: { type: 'number', description: 'Samples per second (default 30).' },
        },
        required: [],
      },
    },
  },
];
