import type { MasterAudioState } from '../../../types';

export const DEFAULT_MASTER_AUDIO_STATE: MasterAudioState = {
  volumeDb: 0,
  limiterEnabled: false,
  truePeakCeilingDb: -1,
  targetLufs: -14,
  effectStack: [],
};
