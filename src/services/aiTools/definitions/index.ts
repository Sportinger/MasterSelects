// AI Tool Definitions - Combined export

import { timelineToolDefinitions } from './timeline';
import { clipToolDefinitions } from './clips';
import { trackToolDefinitions } from './tracks';
import { analysisToolDefinitions } from './analysis';
import { previewToolDefinitions } from './preview';
import { mediaToolDefinitions } from './media';
import { batchToolDefinitions } from './batch';
import { youtubeToolDefinitions } from './youtube';
import { transformToolDefinitions } from './transform';
import { effectToolDefinitions } from './effects';
import { keyframeToolDefinitions } from './keyframes';
import { playbackToolDefinitions } from './playback';
import { transitionToolDefinitions } from './transitions';
import { maskToolDefinitions } from './masks';
import { statsToolDefinitions } from './stats';

// Combined tool definitions array (OpenAI function calling format)
export const AI_TOOLS = [
  ...timelineToolDefinitions,
  ...clipToolDefinitions,
  ...trackToolDefinitions,
  ...previewToolDefinitions,
  ...analysisToolDefinitions,
  ...mediaToolDefinitions,
  ...batchToolDefinitions,
  ...youtubeToolDefinitions,
  ...transformToolDefinitions,
  ...effectToolDefinitions,
  ...keyframeToolDefinitions,
  ...playbackToolDefinitions,
  ...transitionToolDefinitions,
  ...maskToolDefinitions,
  ...statsToolDefinitions,
];

// Re-export individual definition sets for selective use
export {
  timelineToolDefinitions,
  clipToolDefinitions,
  trackToolDefinitions,
  analysisToolDefinitions,
  previewToolDefinitions,
  mediaToolDefinitions,
  batchToolDefinitions,
  youtubeToolDefinitions,
  transformToolDefinitions,
  effectToolDefinitions,
  keyframeToolDefinitions,
  playbackToolDefinitions,
  transitionToolDefinitions,
  maskToolDefinitions,
  statsToolDefinitions,
};
