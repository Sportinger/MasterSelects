import { evaluateAgentTimelineBenchmarkGate } from '../benchmark/analysisBenchmarkGate';
import type { OcrDecision, OcrGateInput, OcrLanguagePack } from '../../../types/agentTimeline/ocr';

function requiredPacks(languages: readonly string[], packs: readonly OcrLanguagePack[]): OcrLanguagePack[] {
  return [...new Set(languages.map((language) => language.trim()).filter(Boolean))]
    .map((language) => packs.find((pack) => pack.language === language))
    .filter((pack): pack is OcrLanguagePack => pack !== undefined);
}

/** Decides availability only; it never downloads packages or starts an OCR engine. */
export function decideOcrExecution(input: OcrGateInput): OcrDecision {
  const languages = [...new Set(input.languages.map((language) => language.trim()).filter(Boolean))].toSorted();
  if (languages.length === 0) throw new TypeError('OCR requires at least one language');
  if (!Number.isSafeInteger(input.policy.maximumRequiredDownloadBytes) || input.policy.maximumRequiredDownloadBytes < 0) {
    throw new RangeError('OCR download budget must be a non-negative safe integer');
  }
  if (input.profile === 'quick') return {
    status: 'disabled', profile: input.profile, requiredLanguages: languages, requiredDownloadBytes: 0,
    reasons: ['quick-profile-disabled'], benchmarkMeasurementIds: [],
  };
  if (input.availability.state !== 'ready') return {
    status: 'unavailable', profile: input.profile, requiredLanguages: languages, requiredDownloadBytes: 0,
    reasons: ['engine-unavailable'], benchmarkMeasurementIds: [],
  };
  const packs = requiredPacks(languages, input.availability.languagePacks);
  if (packs.length !== languages.length || packs.some((pack) => pack.state === 'unavailable')) return {
    status: 'unavailable', profile: input.profile, requiredLanguages: languages, requiredDownloadBytes: 0,
    reasons: ['language-pack-unavailable'], benchmarkMeasurementIds: [],
  };
  const requiredDownloadBytes = packs.filter((pack) => pack.state === 'download-required').reduce((sum, pack) => sum + pack.bytes, 0);
  if (requiredDownloadBytes > input.policy.maximumRequiredDownloadBytes) return {
    status: 'blocked', profile: input.profile, requiredLanguages: languages, requiredDownloadBytes,
    reasons: ['download-budget-exceeded'], benchmarkMeasurementIds: [],
  };
  if (requiredDownloadBytes > 0) return {
    status: 'requires-local-download', profile: input.profile, requiredLanguages: languages, requiredDownloadBytes,
    reasons: ['language-pack-download-required'], benchmarkMeasurementIds: [],
  };
  const policy = input.policy.benchmarkPolicy;
  if (!policy || policy.profile !== input.profile || policy.channel !== 'text') return {
    status: 'blocked', profile: input.profile, requiredLanguages: languages, requiredDownloadBytes: 0,
    reasons: ['benchmark-evidence-required'], benchmarkMeasurementIds: [],
  };
  const gate = evaluateAgentTimelineBenchmarkGate(policy, input.measurements ?? []);
  return {
    status: gate.passed ? 'enabled' : 'blocked', profile: input.profile, requiredLanguages: languages,
    requiredDownloadBytes: 0, reasons: gate.passed ? [] : ['benchmark-gate-failed'],
    benchmarkMeasurementIds: gate.evaluatedMeasurementIds,
  };
}
