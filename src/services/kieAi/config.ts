export const BASE_URL = 'https://api.kie.ai';
export const UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
export const BYO_PROXY_REQUEST_URL = '/api/kieai/byo/request';
export const BYO_PROXY_UPLOAD_URL = '/api/kieai/byo/upload';

export const SEEDANCE_2_PROVIDER_ID = 'bytedance/seedance-2';
export const SEEDANCE_2_FAST_PROVIDER_ID = 'bytedance/seedance-2-fast';
export const SEEDANCE_2_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
export const SEEDANCE_2_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export const FLUX_KONTEXT_PRO_PROVIDER_ID = 'flux-kontext-pro';
export const FLUX_KONTEXT_MAX_PROVIDER_ID = 'flux-kontext-max';
export const RECRAFT_REMOVE_BACKGROUND_PROVIDER_ID = 'recraft/remove-background';
export const RECRAFT_CRISP_UPSCALE_PROVIDER_ID = 'recraft/crisp-upscale';
export const TOPAZ_IMAGE_UPSCALE_PROVIDER_ID = 'topaz/image-upscale';
export const TOPAZ_VIDEO_UPSCALE_PROVIDER_ID = 'topaz/video-upscale';
export const VEO_3_1_PROVIDER_ID = 'veo-3.1';
export const RUNWAY_VIDEO_PROVIDER_ID = 'runway-video';
export const RUNWAY_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function canUseSameOriginProxy(): boolean {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}
