/**
 * Freezes the streaming export-render boundary.
 * First implementor: FrameExporter.
 * Eliminates class-c getState reads across export setup, per-frame render,
 * capture, audio range rendering, cancellation, and cleanup. Captures are
 * returned one frame at a time and must not imply retained frame arrays.
 */

import type { EncodedAudioResult } from '../../audio';
import type { Layer } from '../../core/types';

export interface ExportRenderFrameInput {
  readonly time: number;
  readonly layers: readonly Layer[];
  readonly timestampMicros?: number;
  readonly durationMicros?: number;
}

export interface ExportVideoFrameCapture {
  readonly kind: 'video-frame';
  readonly frame: VideoFrame;
  readonly width: number;
  readonly height: number;
  readonly timestampMicros?: number;
  readonly durationMicros?: number;
}

export interface ExportPixelFrameCapture {
  readonly kind: 'rgba-pixels';
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly timestampMicros?: number;
  readonly durationMicros?: number;
}

export type ExportFrameCapture = ExportVideoFrameCapture | ExportPixelFrameCapture;

export interface ExportAudioRange {
  readonly startTime: number;
  readonly endTime: number;
}

export type ExportAudioProgressPhase =
  | 'extracting'
  | 'processing'
  | 'effects'
  | 'mixing'
  | 'encoding'
  | 'complete';

export interface ExportAudioProgress {
  readonly phase: ExportAudioProgressPhase;
  readonly percent: number;
  readonly currentClip?: string;
  readonly message?: string;
}

export type ExportAudioProgressHandler = (progress: ExportAudioProgress) => void;

export interface ExportAudioCapture {
  readonly kind: 'encoded-audio';
  readonly range: ExportAudioRange;
  readonly result: EncodedAudioResult;
}

export interface ExportRenderSession {
  readonly runId: string;
  readonly signal: AbortSignal;
  begin(): void | Promise<void>;
  renderFrame(input: ExportRenderFrameInput): ExportFrameCapture | Promise<ExportFrameCapture>;
  renderAudio?(
    range: ExportAudioRange,
    onProgress?: ExportAudioProgressHandler,
  ): ExportAudioCapture | null | Promise<ExportAudioCapture | null>;
  cancel?(reason?: string): void | Promise<void>;
  dispose(): void | Promise<void>;
}
