import type {
  ExternalMediaOrigin,
  ExternalMediaProvider,
  ExternalMediaRightsStatus,
} from '../../types/mediaMetadata';

export type MediaDiscoveryKind = 'image' | 'video' | 'audio';
export type MediaDiscoveryContentFilter =
  | 'all'
  | 'memes'
  | 'gifs'
  | 'stickers'
  | 'reactions'
  | 'green-screen'
  | 'overlays'
  | 'sound-effects'
  | 'music'
  | 'viral';

export interface MediaDiscoveryAsset {
  id: string;
  provider: ExternalMediaProvider;
  providerLabel: string;
  kind: MediaDiscoveryKind;
  title: string;
  previewUrl?: string;
  downloadUrl: string;
  sourcePageUrl: string;
  creator?: string;
  creatorUrl?: string;
  licenseName: string;
  licenseUrl?: string;
  attribution?: string;
  rightsStatus: ExternalMediaRightsStatus;
  rightsNote?: string;
  contextUrl?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export function discoveryAssetKey(asset: MediaDiscoveryAsset): string {
  return `${asset.provider}:${asset.id}`;
}

export function externalOriginForAsset(asset: MediaDiscoveryAsset): ExternalMediaOrigin {
  return {
    provider: asset.provider,
    providerLabel: asset.providerLabel,
    assetId: asset.id,
    sourcePageUrl: asset.sourcePageUrl,
    contextUrl: asset.contextUrl,
    originalUrl: asset.downloadUrl,
    creator: asset.creator,
    creatorUrl: asset.creatorUrl,
    licenseName: asset.licenseName,
    licenseUrl: asset.licenseUrl,
    attribution: asset.attribution,
    rightsStatus: asset.rightsStatus,
    rightsNote: asset.rightsNote,
    retrievedAt: new Date().toISOString(),
  };
}
