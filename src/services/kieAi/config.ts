export const BASE_URL = 'https://api.kie.ai';
export const UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
export const BYO_PROXY_REQUEST_URL = '/api/kieai/byo/request';
export const BYO_PROXY_UPLOAD_URL = '/api/kieai/byo/upload';

export const SEEDANCE_2_PROVIDER_ID = 'bytedance/seedance-2';
export const SEEDANCE_2_FAST_PROVIDER_ID = 'bytedance/seedance-2-fast';
export const SEEDANCE_2_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
export const SEEDANCE_2_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function canUseSameOriginProxy(): boolean {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}
