import type {
  RenderCommand,
  RenderCommandTarget,
  RenderGraphId,
  RenderGraphVector2,
} from '../../engine/render/contracts/workerRenderGraph';
import type {
  WorkerGpuRuntimeCommand,
  WorkerGpuWebCodecsFrameLayer,
} from './workerGpuRuntimeCommands';
import type {
  TransitionCenterAxis,
  TransitionPatternMask,
  TransitionProceduralMask,
  TransitionShapeMask,
  TransitionWipeDirection,
} from '../../transitions/types';
import type { RuntimePrimaryColorParams } from '../../types/colorCorrection';

export interface WorkerRenderHostTargetSurfaceCommand {
  readonly targetId: RenderGraphId;
  readonly canvas: OffscreenCanvas;
  readonly presentation: Extract<RenderCommandTarget['presentation'], 'offscreen-canvas' | 'software'>;
}

export interface WorkerRenderSoftwareBitmapLayerSource {
  readonly kind: 'bitmap';
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly cacheKey?: string;
  readonly retained?: boolean;
}

export interface WorkerRenderSoftwareCachedBitmapLayerSource {
  readonly kind: 'cached-bitmap';
  readonly cacheKey: string;
  readonly width: number;
  readonly height: number;
}

export interface WorkerRenderSoftwareSolidLayerSource {
  readonly kind: 'solid';
  readonly color: string;
}

export type WorkerRenderSoftwareLayerSource =
  | WorkerRenderSoftwareBitmapLayerSource
  | WorkerRenderSoftwareCachedBitmapLayerSource
  | WorkerRenderSoftwareSolidLayerSource;

export interface WorkerRenderSoftwareLayerGeometry {
  readonly position: RenderGraphVector2;
  readonly scale: RenderGraphVector2;
  readonly rotation: number;
  readonly sourceRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export type WorkerRenderSoftwareTransition =
  | {
      readonly kind: 'wipe';
      readonly direction: TransitionWipeDirection;
      readonly progress: number;
    }
  | {
      readonly kind: 'soft-wipe';
      readonly direction: TransitionWipeDirection;
      readonly progress: number;
      readonly angle: number;
      readonly feather: number;
    }
  | {
      readonly kind: 'shape-mask';
      readonly shape: TransitionShapeMask;
      readonly progress: number;
    }
  | {
      readonly kind: 'center-mask';
      readonly axis: TransitionCenterAxis;
      readonly progress: number;
    }
  | {
      readonly kind: 'clock-mask';
      readonly progress: number;
    }
  | {
      readonly kind: 'procedural-mask';
      readonly procedural: TransitionProceduralMask;
      readonly progress: number;
      readonly seed: number;
    }
  | {
      readonly kind: 'pattern-mask';
      readonly pattern: TransitionPatternMask;
      readonly progress: number;
    };

export interface WorkerRenderSoftwarePixelEffects {
  readonly brightness: number;
  readonly acuarelaAdjustments?: readonly {
    readonly feedbackKey: string;
    readonly opacity: number;
    readonly gain: number;
    readonly speed: number;
    readonly detail: number;
    readonly strength: number;
    readonly density: number;
    readonly gainX: number;
    readonly gainY: number;
    readonly reset: boolean;
  }[];
  readonly rom1Adjustments?: readonly {
    readonly feedbackKey: string;
    readonly opacity: number;
    readonly gain: number;
    readonly speed: number;
    readonly detail: number;
    readonly strength: number;
    readonly density: number;
    readonly gainX: number;
    readonly gainY: number;
    readonly reset: boolean;
  }[];
  readonly exposureAdjustments?: readonly {
    readonly exposure: number;
    readonly offset: number;
    readonly gamma: number;
  }[];
  readonly temperatureAdjustments?: readonly {
    readonly temperature: number;
    readonly tint: number;
  }[];
  readonly vibranceAdjustments?: readonly {
    readonly amount: number;
  }[];
  readonly levelsAdjustments?: readonly {
    readonly inputBlack: number;
    readonly inputWhite: number;
    readonly gamma: number;
    readonly outputBlack: number;
    readonly outputWhite: number;
  }[];
  readonly thresholdAdjustments?: readonly {
    readonly level: number;
  }[];
  readonly posterizeAdjustments?: readonly {
    readonly levels: number;
  }[];
  readonly vignetteAdjustments?: readonly {
    readonly amount: number;
    readonly size: number;
    readonly softness: number;
    readonly roundness: number;
  }[];
  readonly chromaKeyAdjustments?: readonly {
    readonly keyColor: 'green' | 'blue';
    readonly tolerance: number;
    readonly softness: number;
    readonly spillSuppression: number;
  }[];
  readonly edgeDetectAdjustments?: readonly {
    readonly strength: number;
    readonly invert: boolean;
  }[];
  readonly sharpenAdjustments?: readonly {
    readonly amount: number;
    readonly radius: number;
  }[];
  readonly glowAdjustments?: readonly {
    readonly amount: number;
    readonly threshold: number;
    readonly radius: number;
    readonly softness: number;
    readonly rings: number;
    readonly samplesPerRing: number;
  }[];
  readonly scanlineAdjustments?: readonly {
    readonly density: number;
    readonly opacity: number;
    readonly speed: number;
  }[];
  readonly grainAdjustments?: readonly {
    readonly amount: number;
    readonly size: number;
    readonly speed: number;
  }[];
  readonly waveAdjustments?: readonly {
    readonly amplitudeX: number;
    readonly amplitudeY: number;
    readonly frequencyX: number;
    readonly frequencyY: number;
  }[];
  readonly kaleidoscopeAdjustments?: readonly {
    readonly segments: number;
    readonly rotation: number;
  }[];
  readonly twirlAdjustments?: readonly {
    readonly amount: number;
    readonly radius: number;
    readonly centerX: number;
    readonly centerY: number;
  }[];
  readonly bulgeAdjustments?: readonly {
    readonly amount: number;
    readonly radius: number;
    readonly centerX: number;
    readonly centerY: number;
  }[];
  readonly motionBlurAdjustments?: readonly {
    readonly amount: number;
    readonly angle: number;
    readonly samples: number;
  }[];
  readonly radialBlurAdjustments?: readonly {
    readonly amount: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly samples: number;
  }[];
  readonly zoomBlurAdjustments?: readonly {
    readonly amount: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly samples: number;
  }[];
  readonly mirrorHorizontal?: boolean;
  readonly mirrorVertical?: boolean;
  readonly pixelateSize?: number;
  readonly rgbSplit?: {
    readonly amount: number;
    readonly angle: number;
  };
  readonly colorGradePrimaryNodes?: readonly RuntimePrimaryColorParams[];
}

export interface WorkerRenderSoftwareLayer {
  readonly id: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly compositeOperation: GlobalCompositeOperation;
  readonly filter: string;
  readonly pixelEffects: WorkerRenderSoftwarePixelEffects;
  readonly transition?: WorkerRenderSoftwareTransition;
  readonly diagnosticContentKey?: string;
  readonly geometry: WorkerRenderSoftwareLayerGeometry;
  readonly source: WorkerRenderSoftwareLayerSource;
}

export interface WorkerRenderSoftwareFrame {
  readonly size: RenderGraphVector2;
  readonly layers: readonly WorkerRenderSoftwareLayer[];
}

export interface WorkerRenderHostRuntimeCapabilities {
  readonly workerNavigatorGpu: boolean;
  readonly workerWebGpuDevice: boolean;
  readonly offscreenCanvas: boolean;
  readonly offscreenCanvasWebGpuContext: boolean;
  readonly createImageBitmap: boolean;
  readonly videoDecoder: boolean;
  readonly videoFrame: boolean;
  readonly encodedVideoChunk: boolean;
  readonly videoDecoderConfigSupport: boolean;
  readonly canConstructVideoDecoder: boolean;
  readonly canDecodeVideoInWorker: boolean;
}

export type WorkerRenderHostWebCodecsSeekMode = 'seek' | 'scrub' | 'fast' | 'advance' | 'reverse' | 'stream';

export interface WorkerRenderHostWebCodecsStatus {
  readonly sourceId: string;
  readonly ready: boolean;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly currentTime: number;
  readonly hasFrame: boolean;
  readonly pendingSeekTime: number | null;
  readonly decodePending: boolean;
  readonly decodeQueueSize?: number;
  readonly samplesLoaded?: number;
  readonly sampleIndex?: number;
  readonly feedIndex?: number;
  readonly frameBufferSize?: number;
  readonly decoderState?: string | null;
  readonly currentFrameTimestampSeconds?: number | null;
  readonly pendingSeekKind?: string | null;
  readonly pendingSeekTargetSeconds?: number | null;
  readonly pendingSeekFeedEndIndex?: number | null;
  readonly decodeErrorCount?: number;
  readonly lastDecodeError?: string | null;
  readonly lastError?: string | null;
  readonly decodedFrameCount?: number;
  readonly lastDecodedFrameTimestampSeconds?: number | null;
  readonly reverseFrameCacheSize?: number;
  readonly reverseCaptureTargetSeconds?: number | null;
  readonly reverseCaptureWindowMinSeconds?: number | null;
  readonly reverseCaptureWindowMaxSeconds?: number | null;
  readonly reverseFrameCacheMinTimestampSeconds?: number | null;
  readonly reverseFrameCacheMaxTimestampSeconds?: number | null;
  readonly lastSeekPlan?: {
    readonly targetIndex: number;
    readonly keyframeIndex: number;
    readonly feedEndIndex: number;
    readonly targetTimeSeconds: number;
    readonly targetSampleTimeSeconds: number | null;
    readonly keyframeTimeSeconds: number | null;
  } | null;
}

export interface WorkerRenderHostWebCodecsFrame {
  readonly sourceId: string;
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly timestampSeconds: number;
}

export interface WorkerRenderHostWebCodecsResult {
  readonly status: WorkerRenderHostWebCodecsStatus;
  readonly frame: WorkerRenderHostWebCodecsFrame | null;
}

export interface WorkerRenderHostGpuTransferredVideoFrameLayer extends WorkerGpuWebCodecsFrameLayer {
  readonly frame: ImageBitmap;
  readonly timestampSeconds?: number | null;
}

export type WorkerRenderHostRuntimeCommand =
  | RenderCommand
  | WorkerGpuRuntimeCommand
  | { readonly type: 'probeCapabilities'; readonly requestId: string }
  | {
      readonly type: 'loadWebCodecsSource';
      readonly requestId: string;
      readonly sourceId: string;
      readonly buffer: ArrayBuffer;
      readonly hardwareAcceleration?: HardwareAcceleration;
      readonly returnBitmap?: boolean;
    }
  | {
      readonly type: 'readWebCodecsFrame';
      readonly requestId: string;
      readonly sourceId: string;
      readonly timeSeconds: number;
      readonly mode: WorkerRenderHostWebCodecsSeekMode;
      readonly timeoutMs?: number;
    }
  | {
      readonly type: 'disposeWebCodecsSource';
      readonly requestId: string;
      readonly sourceId: string;
    }
  | {
      readonly type: 'presentGpuTransferredVideoFrames';
      readonly requestId: string;
      readonly targetId: RenderGraphId;
      readonly timelineTime: number;
      readonly frameIndex: number;
      readonly layers: readonly WorkerRenderHostGpuTransferredVideoFrameLayer[];
    }
  | { readonly type: 'attachTargetSurface'; readonly surface: WorkerRenderHostTargetSurfaceCommand }
  | { readonly type: 'detachTargetSurface'; readonly targetId: RenderGraphId }
  | {
      readonly type: 'presentSoftwareFrame';
      readonly requestId: string;
      readonly targetId: RenderGraphId;
      readonly timelineTime: number;
      readonly frame: WorkerRenderSoftwareFrame;
      readonly readback?: boolean;
    };
