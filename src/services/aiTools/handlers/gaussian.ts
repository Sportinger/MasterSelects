// AI Tool Handlers — Gaussian Splat Avatar debugging

import type { ToolResult } from '../types';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
/**
 * getGaussianStatus — full snapshot of the renderer singleton
 */
export async function handleGetGaussianStatus(): Promise<ToolResult> {
  try {
    // Dynamic import to avoid pulling the module into the main bundle unnecessarily
    const { getGaussianSplatSceneRenderer } = await import('../../../engine/gaussian/GaussianSplatSceneRenderer');
    const renderer = getGaussianSplatSceneRenderer();

    const canvas = renderer.getCanvas();
    let webglOk: boolean | string = false;
    if (canvas) {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      webglOk = gl ? (!gl.isContextLost() ? true : 'context-lost') : 'no-context';
    }

    // Check if the hidden container is in the DOM
    const containers = document.querySelectorAll('div[style*="-9999px"]');

    return {
      success: true,
      data: {
        isInitialized: renderer.isInitialized,
        isAvatarLoaded: renderer.isAvatarLoaded,
        isLoading: renderer.isLoading,
        canvas: canvas ? {
          exists: true,
          width: canvas.width,
          height: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
          webglStatus: webglOk,
        } : { exists: false },
        hiddenContainerCount: containers.length,
        // Access private fields via indexing for debug
        currentAvatarUrl: (renderer as any).currentAvatarUrl ?? null,
        moduleLoaded: !!(renderer as any).module,
        rendererInstance: !!(renderer as any).renderer,
        blendshapes: (renderer as any).blendshapes ?? {},
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to get gaussian status: ${err}` };
  }
}

/**
 * getGaussianClips — all gaussian-avatar clips on the timeline
 */
export async function handleGetGaussianClips(): Promise<ToolResult> {
  try {
    const { clips } = useTimelineStore.getState();
    const { files } = useMediaStore.getState();

    const gaussianClips = clips
      .filter(c => c.source?.type === 'gaussian-avatar')
      .map(c => {
        const mediaFile = files.find(f => f.id === c.mediaFileId);
        return {
          clipId: c.id,
          name: c.name,
          trackId: c.trackId,
          startTime: c.startTime,
          duration: c.duration,
          is3D: c.is3D,
          isLoading: c.isLoading,
          mediaFileId: c.mediaFileId,
          source: {
            type: c.source?.type,
            gaussianAvatarUrl: c.source?.gaussianAvatarUrl ?? null,
            gaussianBlendshapes: c.source?.gaussianBlendshapes ?? null,
            naturalDuration: c.source?.naturalDuration,
          },
          mediaFile: mediaFile ? {
            id: mediaFile.id,
            name: mediaFile.name,
            type: mediaFile.type,
            url: mediaFile.url,
            fileSize: mediaFile.fileSize,
            isImporting: (mediaFile as any).isImporting,
          } : null,
        };
      });

    return {
      success: true,
      data: {
        count: gaussianClips.length,
        clips: gaussianClips,
        // Also show total clip count for context
        totalClips: clips.length,
        gaussianMediaFiles: files.filter(f => f.type === 'gaussian-avatar').length,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to get gaussian clips: ${err}` };
  }
}

/**
 * getGaussianLayers — check what the LayerBuilder is actually producing
 */
export async function handleGetGaussianLayers(): Promise<ToolResult> {
  try {
    const store = useTimelineStore.getState();
    const { clips, tracks } = store;

    // Find clips that should produce gaussian layers
    const gaussianClips = clips.filter(c => c.source?.type === 'gaussian-avatar');

    // Check current playhead to see if any gaussian clips are active
    const playhead = store.playheadPosition;
    const activeGaussianClips = gaussianClips.filter(c =>
      playhead >= c.startTime && playhead < c.startTime + c.duration
    );

    // Check track visibility for each active clip
    const activeWithTrackInfo = activeGaussianClips.map(c => {
      const track = tracks.find(t => t.id === c.trackId);
      return {
        clipId: c.id,
        name: c.name,
        trackId: c.trackId,
        trackVisible: track?.visible ?? false,
        trackMuted: track?.muted ?? false,
        hasAvatarUrl: !!c.source?.gaussianAvatarUrl,
        avatarUrl: c.source?.gaussianAvatarUrl ?? null,
        is3D: c.is3D,
        isLoading: c.isLoading,
      };
    });

    return {
      success: true,
      data: {
        playhead,
        totalGaussianClips: gaussianClips.length,
        activeAtPlayhead: activeWithTrackInfo.length,
        activeClips: activeWithTrackInfo,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to get gaussian layers: ${err}` };
  }
}

/**
 * testGaussianModule — test just the module fetch + import step
 */
export async function handleTestGaussianModule(): Promise<ToolResult> {
  const steps: Array<{ step: string; ok: boolean; detail: string; ms?: number }> = [];
  const t0 = performance.now();

  try {
    // Step 1: Fetch the module JS
    const fetchStart = performance.now();
    let response: Response;
    try {
      response = await fetch('/gaussian-splat/gaussian-splat-renderer-for-lam.module.js');
      steps.push({
        step: 'fetch_module',
        ok: response.ok,
        detail: `status=${response.status}, contentType=${response.headers.get('content-type')}, size=${response.headers.get('content-length') ?? 'unknown'}`,
        ms: Math.round(performance.now() - fetchStart),
      });
      if (!response.ok) {
        return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
      }
    } catch (fetchErr) {
      steps.push({ step: 'fetch_module', ok: false, detail: `${fetchErr}` });
      return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
    }

    // Step 2: Read text + create blob URL
    const blobStart = performance.now();
    const text = await response.text();
    const blob = new Blob([text], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    steps.push({
      step: 'blob_url',
      ok: true,
      detail: `textLength=${text.length}, blobUrl=${blobUrl.substring(0, 50)}...`,
      ms: Math.round(performance.now() - blobStart),
    });

    // Step 3: Dynamic import
    const importStart = performance.now();
    let mod: any;
    try {
      mod = await import(/* @vite-ignore */ blobUrl);
      const exportNames = Object.keys(mod);
      steps.push({
        step: 'dynamic_import',
        ok: true,
        detail: `exports=[${exportNames.join(', ')}]`,
        ms: Math.round(performance.now() - importStart),
      });
    } catch (importErr) {
      steps.push({
        step: 'dynamic_import',
        ok: false,
        detail: `${importErr}`,
        ms: Math.round(performance.now() - importStart),
      });
      URL.revokeObjectURL(blobUrl);
      return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
    }
    URL.revokeObjectURL(blobUrl);

    // Step 4: Check for GaussianSplatRenderer class
    const hasClass = !!mod.GaussianSplatRenderer;
    const classType = typeof mod.GaussianSplatRenderer;
    const hasGetInstance = hasClass && typeof mod.GaussianSplatRenderer.getInstance === 'function';
    steps.push({
      step: 'check_class',
      ok: hasClass && hasGetInstance,
      detail: `GaussianSplatRenderer=${classType}, hasGetInstance=${hasGetInstance}`,
    });

    return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
  } catch (err) {
    steps.push({ step: 'unexpected_error', ok: false, detail: `${err}` });
    return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
  }
}

/**
 * testGaussianRenderer — end-to-end: init renderer, load avatar, check canvas output
 */
export async function handleTestGaussianRenderer(args: Record<string, unknown>): Promise<ToolResult> {
  const avatarUrl = (args.avatarUrl as string) || '/gaussian-splat/avatar_desktop_arkit.zip';
  const timeoutMs = (typeof args.timeoutMs === 'number' ? args.timeoutMs : 15000);
  const steps: Array<{ step: string; ok: boolean; detail: string; ms?: number }> = [];
  const t0 = performance.now();

  try {
    const { getGaussianSplatSceneRenderer } = await import('../../../engine/gaussian/GaussianSplatSceneRenderer');
    const renderer = getGaussianSplatSceneRenderer();

    // Step 1: Initialize
    const initStart = performance.now();
    if (!renderer.isInitialized) {
      const initOk = await renderer.initialize();
      steps.push({
        step: 'initialize',
        ok: initOk,
        detail: initOk ? 'Module loaded, container created' : 'Initialize failed',
        ms: Math.round(performance.now() - initStart),
      });
      if (!initOk) {
        return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
      }
    } else {
      steps.push({ step: 'initialize', ok: true, detail: 'Already initialized (skipped)' });
    }

    // Step 2: Load avatar
    const loadStart = performance.now();
    if (!renderer.isAvatarLoaded) {
      // First verify the avatar URL is reachable
      try {
        const probe = await fetch(avatarUrl, { method: 'HEAD' });
        steps.push({
          step: 'avatar_probe',
          ok: probe.ok,
          detail: `HEAD ${avatarUrl} → ${probe.status} (size=${probe.headers.get('content-length') ?? '?'})`,
        });
        if (!probe.ok) {
          return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
        }
      } catch (probeErr) {
        steps.push({ step: 'avatar_probe', ok: false, detail: `${probeErr}` });
        return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
      }

      const loadOk = await renderer.loadAvatar(avatarUrl);
      steps.push({
        step: 'load_avatar',
        ok: loadOk,
        detail: loadOk ? `Avatar loaded from ${avatarUrl}` : 'loadAvatar returned false',
        ms: Math.round(performance.now() - loadStart),
      });
      if (!loadOk) {
        return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
      }
    } else {
      steps.push({ step: 'load_avatar', ok: true, detail: 'Already loaded (skipped)' });
    }

    // Step 3: Wait for canvas to have content (the renderer has its own rAF)
    const canvas = renderer.getCanvas();
    if (!canvas) {
      steps.push({ step: 'get_canvas', ok: false, detail: 'getCanvas() returned null' });
      return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
    }

    steps.push({
      step: 'get_canvas',
      ok: true,
      detail: `Canvas ${canvas.width}x${canvas.height}`,
    });

    // Step 4: Check if canvas has non-black pixels (wait a bit for renderer to draw)
    const pixelCheckStart = performance.now();
    let hasPixels = false;
    const checkInterval = 200;
    const maxChecks = Math.ceil(Math.min(timeoutMs, 15000) / checkInterval);

    for (let i = 0; i < maxChecks; i++) {
      await new Promise(r => setTimeout(r, checkInterval));
      try {
        // Read a small region from canvas to check for non-zero pixels
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.min(canvas.width, 64);
        tempCanvas.height = Math.min(canvas.height, 64);
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
          const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          const pixels = imageData.data;
          let nonBlackCount = 0;
          for (let p = 0; p < pixels.length; p += 4) {
            if (pixels[p] > 5 || pixels[p + 1] > 5 || pixels[p + 2] > 5) {
              nonBlackCount++;
            }
          }
          if (nonBlackCount > 10) {
            hasPixels = true;
            steps.push({
              step: 'pixel_check',
              ok: true,
              detail: `Non-black pixels found: ${nonBlackCount}/${tempCanvas.width * tempCanvas.height} (after ${(i + 1) * checkInterval}ms)`,
              ms: Math.round(performance.now() - pixelCheckStart),
            });
            break;
          }
        }
      } catch (pixelErr) {
        // Canvas might be tainted — report but continue
        steps.push({ step: 'pixel_check', ok: false, detail: `Canvas read error: ${pixelErr}` });
        break;
      }
    }

    if (!hasPixels) {
      steps.push({
        step: 'pixel_check',
        ok: false,
        detail: `Canvas still black/empty after ${maxChecks * checkInterval}ms`,
        ms: Math.round(performance.now() - pixelCheckStart),
      });
    }

    // Step 5: Check WebGL context health
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    steps.push({
      step: 'webgl_context',
      ok: !!gl && !gl.isContextLost(),
      detail: gl ? (gl.isContextLost() ? 'context lost!' : `healthy (${gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'})`) : 'no context',
    });

    return {
      success: true,
      data: {
        steps,
        totalMs: Math.round(performance.now() - t0),
        rendererState: {
          isInitialized: renderer.isInitialized,
          isAvatarLoaded: renderer.isAvatarLoaded,
          isLoading: renderer.isLoading,
        },
      },
    };
  } catch (err) {
    steps.push({ step: 'unexpected_error', ok: false, detail: `${err}` });
    return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
  }
}

/**
 * testGaussianImportPipeline — test import → media store → timeline → layer builder
 */
export async function handleTestGaussianImportPipeline(): Promise<ToolResult> {
  const steps: Array<{ step: string; ok: boolean; detail: string; ms?: number }> = [];
  const t0 = performance.now();

  try {
    // Step 1: Fetch the bundled avatar zip as a File object
    const fetchStart = performance.now();
    const avatarPath = '/gaussian-splat/avatar_desktop_arkit.zip';
    let avatarFile: File;
    try {
      const resp = await fetch(avatarPath);
      if (!resp.ok) {
        steps.push({ step: 'fetch_avatar', ok: false, detail: `HTTP ${resp.status} fetching ${avatarPath}` });
        return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
      }
      const blob = await resp.blob();
      avatarFile = new File([blob], 'avatar_desktop_arkit.zip', { type: 'application/zip' });
      steps.push({
        step: 'fetch_avatar',
        ok: true,
        detail: `Fetched ${avatarPath} → File(${avatarFile.size} bytes)`,
        ms: Math.round(performance.now() - fetchStart),
      });
    } catch (fetchErr) {
      steps.push({ step: 'fetch_avatar', ok: false, detail: `${fetchErr}` });
      return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
    }

    // Step 2: Import into media store
    const importStart = performance.now();
    const mediaStore = useMediaStore.getState();
    let mediaFile: any;
    try {
      mediaFile = await mediaStore.importGaussianAvatar(avatarFile);
      steps.push({
        step: 'import_media',
        ok: !!mediaFile,
        detail: mediaFile
          ? `MediaFile id=${mediaFile.id}, type=${mediaFile.type}, name=${mediaFile.name}`
          : 'importGaussianAvatar returned falsy',
        ms: Math.round(performance.now() - importStart),
      });
    } catch (importErr) {
      steps.push({ step: 'import_media', ok: false, detail: `${importErr}`, ms: Math.round(performance.now() - importStart) });
      return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
    }

    // Step 3: Verify media file in store
    const storeFiles = useMediaStore.getState().files;
    const inStore = storeFiles.find(f => f.id === mediaFile.id);
    steps.push({
      step: 'verify_in_store',
      ok: !!inStore,
      detail: inStore
        ? `Found in store: type=${inStore.type}, isImporting=${(inStore as any).isImporting}`
        : 'NOT found in store after import!',
    });

    // Step 4: Add clip to timeline
    const addClipStart = performance.now();
    const timelineStore = useTimelineStore.getState();
    const { tracks } = timelineStore;
    const videoTrack = tracks.find(t => t.type === 'video') || tracks[0];
    if (!videoTrack) {
      steps.push({ step: 'add_clip', ok: false, detail: 'No video track found on timeline' });
      return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
    }

    try {
      await timelineStore.addClip(
        videoTrack.id,
        avatarFile,
        0, // startTime
        30, // estimatedDuration
        mediaFile.id,
        'gaussian-avatar',
      );
      steps.push({
        step: 'add_clip',
        ok: true,
        detail: `addClip called on track ${videoTrack.id}`,
        ms: Math.round(performance.now() - addClipStart),
      });
    } catch (addErr) {
      steps.push({ step: 'add_clip', ok: false, detail: `${addErr}`, ms: Math.round(performance.now() - addClipStart) });
      return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
    }

    // Step 5: Verify clip in timeline store
    await new Promise(r => setTimeout(r, 200)); // small delay for async updates
    const updatedClips = useTimelineStore.getState().clips;
    const gaussianClip = updatedClips.find(c =>
      c.source?.type === 'gaussian-avatar' && c.mediaFileId === mediaFile.id
    );
    steps.push({
      step: 'verify_clip',
      ok: !!gaussianClip,
      detail: gaussianClip
        ? `Clip id=${gaussianClip.id}, is3D=${gaussianClip.is3D}, isLoading=${gaussianClip.isLoading}, hasAvatarUrl=${!!gaussianClip.source?.gaussianAvatarUrl}`
        : 'Gaussian clip NOT found in timeline after addClip',
    });

    if (gaussianClip) {
      steps.push({
        step: 'clip_source_detail',
        ok: true,
        detail: JSON.stringify({
          sourceType: gaussianClip.source?.type,
          avatarUrl: gaussianClip.source?.gaussianAvatarUrl?.substring(0, 60) ?? null,
          blendshapes: gaussianClip.source?.gaussianBlendshapes,
        }),
      });
    }

    return {
      success: true,
      data: {
        steps,
        totalMs: Math.round(performance.now() - t0),
      },
    };
  } catch (err) {
    steps.push({ step: 'unexpected_error', ok: false, detail: `${err}` });
    return { success: true, data: { steps, totalMs: Math.round(performance.now() - t0) } };
  }
}
