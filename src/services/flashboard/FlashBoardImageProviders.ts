import { cloudAiService } from '../cloudAiService';
import { evolinkService } from '../evolinkService';
import type { TextToImageParams } from '../aiGenerationContracts';
import type { VideoTask } from '../piApiService';
import type { FlashBoardService } from '../../stores/flashboardStore/types';

export interface FlashBoardImageProvider {
  createTextToImage(params: TextToImageParams): Promise<string>;
  pollImageTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval?: number,
    timeout?: number,
  ): Promise<VideoTask>;
  setApiKey?: (apiKey: string) => void;
}

const FLASHBOARD_IMAGE_PROVIDERS: Partial<Record<FlashBoardService, FlashBoardImageProvider>> = {
  cloud: {
    createTextToImage: (params) => cloudAiService.createTextToImage(params),
    pollImageTaskUntilComplete: (taskId, onProgress, pollInterval, timeout) => (
      cloudAiService.pollTaskUntilComplete(taskId, onProgress, pollInterval, timeout)
    ),
  },
  evolink: evolinkService,
};

export function getFlashBoardImageProvider(service: FlashBoardService): FlashBoardImageProvider | null {
  return FLASHBOARD_IMAGE_PROVIDERS[service] ?? null;
}

export function getFlashBoardImageProviderServices(): FlashBoardService[] {
  return Object.keys(FLASHBOARD_IMAGE_PROVIDERS) as FlashBoardService[];
}
