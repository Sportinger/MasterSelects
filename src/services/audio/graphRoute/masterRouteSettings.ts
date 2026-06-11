import { dbToLinearGain } from '../../../engine/audio/audioMath';
import type { AudioEffectInstance } from '../../nodeGraph/clipGraphProjectionDomain';
import { getRuntimeMasterVolumeDbOverride } from '../runtimeAudioParamOverrides';
import { collectAudioEffectInstanceRouteSettings } from './processorInstanceMapping';
import type { AudioRouteEffectSettings } from './routeSettingsModel';

interface MasterAudioRouteInput {
  volumeDb?: number;
  effectStack?: readonly AudioEffectInstance[];
}

export function collectMasterRouteEffectSettings(
  masterAudioState: MasterAudioRouteInput | undefined,
): AudioRouteEffectSettings {
  const settings = collectAudioEffectInstanceRouteSettings(masterAudioState?.effectStack);
  settings.volume *= dbToLinearGain(getRuntimeMasterVolumeDbOverride() ?? masterAudioState?.volumeDb);
  return settings;
}
