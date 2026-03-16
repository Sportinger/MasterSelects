// TFE Pipeline AI Tool Handlers
// HTTP calls to the TFE Python backend (FastAPI on port 8786)

import { useSettingsStore } from '../../../stores/settingsStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { Logger } from '../../logger';
import type { ToolResult } from '../types';

const log = Logger.create('AITool:TFE');

/** Get the TFE backend base URL from settings */
function getTfeBaseUrl(): string {
  const { tfeBackendUrl } = useSettingsStore.getState();
  return tfeBackendUrl || 'http://127.0.0.1:8786';
}

/** Make a request to the TFE backend */
async function tfeRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = `${getTfeBaseUrl()}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = errorJson.detail || errorJson.error || errorText;
      } catch {
        errorMsg = errorText;
      }
      return { ok: false, error: `TFE API error (${response.status}): ${errorMsg}` };
    }

    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
      return {
        ok: false,
        error: 'TFE backend not reachable. Make sure the TFE API server is running (python -m src.api_server).',
      };
    }
    return { ok: false, error: `TFE request failed: ${msg}` };
  }
}

// === Imagen Handlers ===

export async function handleTfeGenerateThumbnail(args: Record<string, unknown>): Promise<ToolResult> {
  const title = args.title as string;
  if (!title) return { success: false, error: 'title is required' };

  const res = await tfeRequest('POST', '/api/tfe/generate-thumbnail', {
    title,
    description: (args.description as string) || '',
  });

  if (!res.ok) return { success: false, error: res.error };
  log.info(`TFE generate-thumbnail job started: ${(res.data as any).job_id}`);
  return { success: true, data: res.data };
}

export async function handleTfeGenerateTitle(args: Record<string, unknown>): Promise<ToolResult> {
  const title = args.title as string;
  if (!title) return { success: false, error: 'title is required' };

  const res = await tfeRequest('POST', '/api/tfe/generate-title', {
    title,
    style: (args.style as string) || 'cinematic',
  });

  if (!res.ok) return { success: false, error: res.error };
  log.info(`TFE generate-title job started: ${(res.data as any).job_id}`);
  return { success: true, data: res.data };
}

// === Veo Handlers ===

export async function handleTfeVeoTextToVideo(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = args.prompt as string;
  if (!prompt) return { success: false, error: 'prompt is required' };

  const res = await tfeRequest('POST', '/api/tfe/veo/text-to-video', {
    prompt,
    duration: (args.duration as number) || 8,
    resolution: (args.resolution as string) || '720p',
    aspect_ratio: (args.aspectRatio as string) || '16:9',
    fast: (args.fast as boolean) || false,
    generate_audio: (args.generateAudio as boolean) || false,
  });

  if (!res.ok) return { success: false, error: res.error };
  log.info(`TFE Veo text-to-video job started: ${(res.data as any).job_id}`);
  return {
    success: true,
    data: {
      ...(res.data as object),
      message: 'Video generation started. Use tfeGetJobStatus with the job_id to check progress (typically 30-120 seconds).',
    },
  };
}

export async function handleTfeVeoImageToVideo(args: Record<string, unknown>): Promise<ToolResult> {
  const imagePath = args.imagePath as string;
  if (!imagePath) return { success: false, error: 'imagePath is required' };

  const res = await tfeRequest('POST', '/api/tfe/veo/image-to-video', {
    image_path: imagePath,
    prompt: (args.prompt as string) || '',
    duration: (args.duration as number) || 8,
  });

  if (!res.ok) return { success: false, error: res.error };
  log.info(`TFE Veo image-to-video job started: ${(res.data as any).job_id}`);
  return { success: true, data: res.data };
}

// === Mosaic Handlers ===

export async function handleTfeMosaicRun(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args.filePath as string;
  const prompt = args.prompt as string;
  if (!filePath) return { success: false, error: 'filePath is required' };
  if (!prompt) return { success: false, error: 'prompt is required' };

  const res = await tfeRequest('POST', '/api/tfe/mosaic/run', {
    file_path: filePath,
    prompt,
  });

  if (!res.ok) return { success: false, error: res.error };
  log.info(`TFE Mosaic job started: ${(res.data as any).job_id}`);
  return { success: true, data: res.data };
}

// === FFmpeg Handlers ===

export async function handleTfeFfmpegTrim(args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = args.inputPath as string;
  const start = args.start as string;
  const end = args.end as string;
  if (!inputPath || !start || !end) {
    return { success: false, error: 'inputPath, start, and end are required' };
  }

  const res = await tfeRequest('POST', '/api/tfe/ffmpeg/trim', {
    input_path: inputPath,
    start,
    end,
  });

  if (!res.ok) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

export async function handleTfeFfmpegConcat(args: Record<string, unknown>): Promise<ToolResult> {
  const inputPaths = args.inputPaths as string[];
  if (!inputPaths?.length) return { success: false, error: 'inputPaths array is required' };

  const res = await tfeRequest('POST', '/api/tfe/ffmpeg/concat', {
    input_paths: inputPaths,
  });

  if (!res.ok) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

export async function handleTfeFfmpegImageToVideo(args: Record<string, unknown>): Promise<ToolResult> {
  const imagePath = args.imagePath as string;
  if (!imagePath) return { success: false, error: 'imagePath is required' };

  const res = await tfeRequest('POST', '/api/tfe/ffmpeg/image-to-video', {
    image_path: imagePath,
    duration: (args.duration as number) || 5.0,
    fps: (args.fps as number) || 30,
    kenburns: (args.kenburns as boolean) || false,
  });

  if (!res.ok) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

// === Claude Handlers ===

export async function handleTfeAnalyzeTasks(args: Record<string, unknown>): Promise<ToolResult> {
  const tasksJson = args.tasksJson as string;
  if (!tasksJson) return { success: false, error: 'tasksJson is required' };

  const res = await tfeRequest('POST', '/api/tfe/claude/analyze', {
    tasks_json: tasksJson,
  });

  if (!res.ok) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

export async function handleTfeOptimizePrompt(args: Record<string, unknown>): Promise<ToolResult> {
  const taskType = args.taskType as string;
  const originalText = args.originalText as string;
  if (!taskType || !originalText) {
    return { success: false, error: 'taskType and originalText are required' };
  }

  const res = await tfeRequest('POST', '/api/tfe/claude/optimize-prompt', {
    task_type: taskType,
    original_text: originalText,
    context: (args.context as string) || '',
  });

  if (!res.ok) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

// === Pipeline Handler ===

export async function handleTfeRunPipeline(args: Record<string, unknown>): Promise<ToolResult> {
  const excelPath = args.excelPath as string;
  if (!excelPath) return { success: false, error: 'excelPath is required' };

  const res = await tfeRequest('POST', '/api/tfe/pipeline/run', {
    excel_path: excelPath,
    project_name: (args.projectName as string) || 'ms_project',
  });

  if (!res.ok) return { success: false, error: res.error };
  log.info(`TFE pipeline job started: ${(res.data as any).job_id}`);
  return {
    success: true,
    data: {
      ...(res.data as object),
      message: 'Full pipeline started. Use tfeGetJobStatus to monitor progress.',
    },
  };
}

// === System Handlers ===

export async function handleTfeGetJobStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const jobId = args.jobId as string;
  if (!jobId) return { success: false, error: 'jobId is required' };

  const res = await tfeRequest('GET', `/api/tfe/jobs/${jobId}`);
  if (!res.ok) return { success: false, error: res.error };

  const job = res.data as any;

  // If job completed with an output_path, offer to import
  if (job.status === 'completed' && job.result?.output_path) {
    return {
      success: true,
      data: {
        ...job,
        hint: 'Job completed! Use importLocalFiles to import the output into the timeline.',
      },
    };
  }

  return { success: true, data: job };
}

export async function handleTfeGetCapabilities(): Promise<ToolResult> {
  const res = await tfeRequest('GET', '/api/tfe/capabilities');
  if (!res.ok) {
    return {
      success: false,
      error: res.error,
    };
  }
  return { success: true, data: res.data };
}
