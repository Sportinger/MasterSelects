import type { GenerationReferenceMedia } from '../piApiService';

export interface KieAiTaskResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
  };
}

export interface KieAiStatusResponse {
  code: number;
  msg?: string;
  data: {
    completeTime?: number;
    taskId: string;
    createTime?: number;
    progress?: number;
    state: string;
    resultJson?: string;
    resultUrls?: string[];
    costTime?: string;
    failMsg?: string;
  };
}

export interface KieAiUploadResponse {
  data?: {
    downloadUrl?: string;
    fileUrl?: string;
  };
  msg?: string;
  success?: boolean;
}

export interface KieAiProxyErrorResponse {
  error?: string;
  message?: string;
}

export interface UploadedReferenceMedia {
  label?: string;
  mediaType: GenerationReferenceMedia['mediaType'];
  url: string;
}
