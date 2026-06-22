import type { TimelineClip } from '../../types';
import { getClipTimeInfo } from './FrameContext';
import { LAYER_BUILDER_CONSTANTS, type FrameContext, type NativeDecoderState } from './types';
import type { VideoSyncNativeDecoder } from './videoSyncMediaResolver';

export class VideoSyncNativeDecoderSync {
  private decoderState = new Map<string, NativeDecoderState>();

  sync(clip: TimelineClip, ctx: FrameContext, nativeDecoder: VideoSyncNativeDecoder): void {
    const timeInfo = getClipTimeInfo(ctx, clip);
    const fps = nativeDecoder.fps || 25;
    const targetFrame = Math.round(timeInfo.visualClipTime * fps);
    let state = this.decoderState.get(clip.id);

    if (!state) {
      state = { lastSeekTime: 0, lastSeekFrame: -1, isPending: false };
      this.decoderState.set(clip.id, state);
    }

    const timeSinceLastSeek = ctx.now - state.lastSeekTime;
    const shouldSeek = !state.isPending &&
      (targetFrame !== state.lastSeekFrame || timeSinceLastSeek > 100);

    if (shouldSeek && timeSinceLastSeek >= LAYER_BUILDER_CONSTANTS.NATIVE_SEEK_THROTTLE_MS) {
      state.lastSeekTime = ctx.now;
      state.lastSeekFrame = targetFrame;
      state.isPending = true;

      nativeDecoder.seekToFrame(targetFrame, ctx.isDraggingPlayhead || ctx.hasClipDragPreview)
        .then(() => {
          state.isPending = false;
        })
        .catch((err: unknown) => {
          state.isPending = false;
          console.warn('[NH] seek failed frame', targetFrame, err);
        });
    }
  }
}
