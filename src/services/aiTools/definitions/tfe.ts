// TFE Pipeline AI Tool Definitions
// Connects MasterSelects to Trendfix Entertainment Python backend

import type { ToolDefinition } from '../types';

export const tfeToolDefinitions: ToolDefinition[] = [
  // --- Imagen (画像生成) ---
  {
    type: 'function',
    function: {
      name: 'tfeGenerateThumbnail',
      description: 'Generate an AI thumbnail image using Google Imagen 3.0 via the TFE backend. Returns a job ID — use tfeGetJobStatus to check completion and get the output file path. The generated image can then be imported into the timeline.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title text to display on the thumbnail',
          },
          description: {
            type: 'string',
            description: 'Additional description or context for the thumbnail design',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tfeGenerateTitle',
      description: 'Generate a cinematic title card image using Google Imagen 3.0 via the TFE backend. Styles: cinematic, corporate, documentary, youtube. Returns a job ID.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title text to generate',
          },
          style: {
            type: 'string',
            enum: ['cinematic', 'corporate', 'documentary', 'youtube'],
            description: 'Visual style of the title card (default: cinematic)',
          },
        },
        required: ['title'],
      },
    },
  },

  // --- Veo (動画生成) ---
  {
    type: 'function',
    function: {
      name: 'tfeVeoTextToVideo',
      description: 'Generate a video from a text prompt using Google Veo 3.1. Supports 4, 6, or 8 second durations. Returns a job ID — video generation takes 30-120 seconds. Use tfeGetJobStatus to poll completion.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed text description of the video to generate',
          },
          duration: {
            type: 'number',
            enum: [4, 6, 8],
            description: 'Video duration in seconds (4, 6, or 8). Default: 8',
          },
          resolution: {
            type: 'string',
            enum: ['720p', '1080p'],
            description: 'Output resolution (default: 720p)',
          },
          aspectRatio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1'],
            description: 'Aspect ratio (default: 16:9)',
          },
          fast: {
            type: 'boolean',
            description: 'Use fast generation model (lower quality, faster). Default: false',
          },
          generateAudio: {
            type: 'boolean',
            description: 'Generate native audio with the video. Default: false',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tfeVeoImageToVideo',
      description: 'Animate a static image into a video using Google Veo 3.1. The image must be accessible from the TFE backend filesystem. Returns a job ID.',
      parameters: {
        type: 'object',
        properties: {
          imagePath: {
            type: 'string',
            description: 'Absolute file path to the source image on the server',
          },
          prompt: {
            type: 'string',
            description: 'Description of how to animate the image (default: "Animate this image naturally")',
          },
          duration: {
            type: 'number',
            enum: [4, 6, 8],
            description: 'Video duration in seconds (default: 8)',
          },
        },
        required: ['imagePath'],
      },
    },
  },

  // --- Mosaic (AI編集) ---
  {
    type: 'function',
    function: {
      name: 'tfeMosaicRun',
      description: 'Run AI video editing via Mosaic Agent. Upload a video and execute an AI editing prompt (e.g., "Add cinematic captions", "Remove silence", "Create highlight reel"). Returns a job ID.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute file path to the video file on the server',
          },
          prompt: {
            type: 'string',
            description: 'Editing instruction for the Mosaic AI agent (in English)',
          },
        },
        required: ['filePath', 'prompt'],
      },
    },
  },

  // --- FFmpeg (動画処理) ---
  {
    type: 'function',
    function: {
      name: 'tfeFfmpegTrim',
      description: 'Trim a video file to a specific time range using FFmpeg. Returns a job ID with the output file path on completion.',
      parameters: {
        type: 'object',
        properties: {
          inputPath: {
            type: 'string',
            description: 'Absolute file path to the input video',
          },
          start: {
            type: 'string',
            description: 'Start timecode (HH:MM:SS or SS format)',
          },
          end: {
            type: 'string',
            description: 'End timecode (HH:MM:SS or SS format)',
          },
        },
        required: ['inputPath', 'start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tfeFfmpegConcat',
      description: 'Concatenate multiple video files into a single video using FFmpeg. Returns a job ID.',
      parameters: {
        type: 'object',
        properties: {
          inputPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of absolute file paths to concatenate in order',
          },
        },
        required: ['inputPaths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tfeFfmpegImageToVideo',
      description: 'Convert a static image to a video clip using FFmpeg. Optionally applies a Ken Burns (zoom pan) effect.',
      parameters: {
        type: 'object',
        properties: {
          imagePath: {
            type: 'string',
            description: 'Absolute file path to the source image',
          },
          duration: {
            type: 'number',
            description: 'Duration of the output video in seconds (default: 5)',
          },
          fps: {
            type: 'number',
            description: 'Frames per second (default: 30)',
          },
          kenburns: {
            type: 'boolean',
            description: 'Apply Ken Burns zoom effect (default: false)',
          },
        },
        required: ['imagePath'],
      },
    },
  },

  // --- Claude (AI分析) ---
  {
    type: 'function',
    function: {
      name: 'tfeAnalyzeTasks',
      description: 'Analyze a set of editing tasks using Claude AI. Returns an optimized execution plan with phases, dependencies, and warnings. Input is a JSON string of task objects.',
      parameters: {
        type: 'object',
        properties: {
          tasksJson: {
            type: 'string',
            description: 'JSON string of tasks array to analyze (each task has type, text, style, file fields)',
          },
        },
        required: ['tasksJson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tfeOptimizePrompt',
      description: 'Optimize a prompt for a specific AI service using Claude. Improves prompts for Imagen, Mosaic, Veo, or narration tasks.',
      parameters: {
        type: 'object',
        properties: {
          taskType: {
            type: 'string',
            description: 'Type of task the prompt is for (e.g., "imagen", "mosaic", "veo", "narration")',
          },
          originalText: {
            type: 'string',
            description: 'The original prompt text to optimize',
          },
          context: {
            type: 'string',
            description: 'Additional context about the project or desired result',
          },
        },
        required: ['taskType', 'originalText'],
      },
    },
  },

  // --- Pipeline (フル実行) ---
  {
    type: 'function',
    function: {
      name: 'tfeRunPipeline',
      description: 'Run the full TFE automated video editing pipeline from an Excel instruction sheet. This executes all steps: Imagen generation, Veo video generation, Mosaic AI editing, FFmpeg processing, and MasterSelects project generation. Returns a job ID for long-running execution.',
      parameters: {
        type: 'object',
        properties: {
          excelPath: {
            type: 'string',
            description: 'Absolute path to the Excel instruction sheet (.xlsx)',
          },
          projectName: {
            type: 'string',
            description: 'Name for the output project (default: "ms_project")',
          },
        },
        required: ['excelPath'],
      },
    },
  },

  // --- System ---
  {
    type: 'function',
    function: {
      name: 'tfeGetJobStatus',
      description: 'Check the status of a TFE backend job. Returns status (queued/running/completed/error), result data, and timing info. Use this to poll long-running operations like Veo video generation.',
      parameters: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'Job ID returned from a previous TFE tool call',
          },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tfeGetCapabilities',
      description: 'List all available TFE backend capabilities and tools. Returns the full list of AI tools provided by the TFE Python backend.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];
