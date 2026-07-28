import type { AgentTimelineEvent } from '../../../../types/agentTimeline/manifest';
import {
  QUALITY_AUDIO_DERIVATION_SCHEMA_VERSION,
  type QualityAudioDerivationInput,
  type QualityAudioDerivationResult,
} from '../../../../types/agentTimeline/qualityAudioDerivations';
import { compareAgentTimelineEvents } from '../../manifest/eventSemantics';
import { deriveAudioEvents } from './audioEventDerivation';
import {
  normalizeThresholds,
  type DerivationContext,
} from './derivationPrimitives';
import { deriveQualityEvents } from './qualityEventDerivation';

function assertInput(input: QualityAudioDerivationInput): void {
  if (!input.sourceId) throw new TypeError('sourceId is required');
  if (!Number.isFinite(input.range.start) || !Number.isFinite(input.range.end) ||
      input.range.start < 0 || input.range.end <= input.range.start) {
    throw new RangeError('Derivation range must be a non-negative half-open interval');
  }
  if (input.timeDomain === 'source' && input.stateHash !== undefined) {
    throw new TypeError('Source-time derivations must not carry a timeline stateHash');
  }
  if (input.timeDomain !== 'source' && !input.stateHash) {
    throw new TypeError('Rendered-time derivations require a stateHash');
  }
}

/**
 * Derives cheap quality/audio events exclusively from persisted measurements
 * supplied by the caller. It performs no media reads, decode or model work.
 */
export function deriveQualityAudioEvents(
  input: QualityAudioDerivationInput,
): QualityAudioDerivationResult {
  assertInput(input);
  const thresholds = normalizeThresholds(input.thresholds);
  const context: DerivationContext = {
    sourceId: input.sourceId,
    timeDomain: input.timeDomain,
    stateHash: input.stateHash,
    range: { ...input.range },
    thresholds,
  };
  const quality = deriveQualityEvents(input.quality, context);
  const audio = deriveAudioEvents(input.audio, context);
  const events: AgentTimelineEvent[] = [...quality.events, ...audio.events]
    .toSorted(compareAgentTimelineEvents);
  return {
    schemaVersion: QUALITY_AUDIO_DERIVATION_SCHEMA_VERSION,
    sourceId: input.sourceId,
    timeDomain: input.timeDomain,
    stateHash: input.stateHash,
    range: { ...input.range },
    thresholds,
    events,
    coverage: {
      ...quality.coverage,
      ...audio.coverage,
    },
  };
}
