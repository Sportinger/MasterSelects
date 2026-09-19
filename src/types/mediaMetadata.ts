/** Serializable video-track metadata shared by media, project, and runtime models. */
export interface MediaPixelAspectRatio {
  numerator: number;
  denominator: number;
}

/** WebCodecs-compatible color-space hints. All fields are optional when unknown. */
export interface MediaVideoColorSpace {
  primaries?: string;
  transfer?: string;
  matrix?: string;
  fullRange?: boolean;
}

/**
 * Container-level video metadata that remains safe to persist.
 * Runtime handles such as decoders, tracks, frames, and files do not belong here.
 */
export interface MediaVideoTrackMetadata {
  /** Raw codec identifier from the container, for example `apch` or `avc1`. */
  videoCodecId?: string;
  codedWidth?: number;
  codedHeight?: number;
  rotation?: number;
  pixelAspectRatio?: MediaPixelAspectRatio;
  videoColorSpace?: MediaVideoColorSpace;
  hasHighDynamicRange?: boolean;
  canBeTransparent?: boolean;
}

/** A durable description of another file that can supply the same media. */
export interface LinkedMediaSource {
  id: string;
  name: string;
  sourcePath?: string;
  fileKey?: string;
  role: 'proxy' | 'alternate';
  origin?: 'premiere';
}

/** Runtime source choice. Live source objects and handles remain in runtime services. */
export type MediaSourceSelection =
  | { mode: 'auto' }
  | { mode: 'original' }
  | { mode: 'linked'; sourceId: string };

export type ExternalMediaProvider =
  | 'wikimedia-commons'
  | 'openverse'
  | 'memegen'
  | 'imgflip'
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'facebook'
  | 'reddit'
  | 'vimeo'
  | 'twitch'
  | 'dailymotion'
  | 'web-download';

export type ExternalMediaRightsStatus = 'open-license' | 'rights-unverified';

/** Durable attribution for media imported from a third-party catalog. */
export interface ExternalMediaOrigin {
  provider: ExternalMediaProvider;
  providerLabel: string;
  assetId: string;
  sourcePageUrl: string;
  contextUrl?: string;
  originalUrl: string;
  creator?: string;
  creatorUrl?: string;
  licenseName: string;
  licenseUrl?: string;
  attribution?: string;
  rightsStatus: ExternalMediaRightsStatus;
  rightsNote?: string;
  retrievedAt: string;
}
