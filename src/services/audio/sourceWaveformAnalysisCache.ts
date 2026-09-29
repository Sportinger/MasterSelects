import { projectFileService } from '../projectFileService';
import type { TimelineWaveformAnalysisResult } from './timelineWaveformPyramidCache';

type SourceResults = WeakMap<File, Map<string, TimelineWaveformAnalysisResult>>;
const unscopedProject = {};
const resultsByProject = new WeakMap<object, SourceResults>();
let nativeProjectPath: string | null = null;
let nativeProjectScope = {};

function sourceResults(): SourceResults {
  const path = projectFileService.getProjectPath();
  if (path !== nativeProjectPath) { nativeProjectPath = path; nativeProjectScope = {}; }
  const scope = projectFileService.getProjectPackageSession()
    ?? projectFileService.getProjectHandle() ?? (path ? nativeProjectScope : unscopedProject);
  let results = resultsByProject.get(scope);
  if (!results) {
    results = new WeakMap();
    resultsByProject.set(scope, results);
  }
  return results;
}

/** Reuse completed source work for split clips; never retain decoded PCM. */
export function sourceWaveformAnalysisCacheForFile(file: File): Map<string, TimelineWaveformAnalysisResult> {
  const sources = sourceResults();
  let results = sources.get(file);
  if (!results) {
    results = new Map();
    sources.set(file, results);
  }
  return results;
}

export function rememberSourceWaveformAnalysis(
  results: Map<string, TimelineWaveformAnalysisResult>,
  key: string,
  result: TimelineWaveformAnalysisResult,
): void {
  results.delete(key);
  results.set(key, result);
  // Bound alternate preview resolutions per source. Payload arrays are shared
  // with the existing waveform cache, rather than copied here.
  if (results.size > 4) results.delete(results.keys().next().value!);
}
