import { projectFileService } from '../projectFileService';
import type { TimelineWaveformAnalysisResult } from './timelineWaveformPyramidCache';

type SourceResults = Map<string, Map<string, TimelineWaveformAnalysisResult>>;
const runtime: {
  unscopedProject: object; resultsByProject: WeakMap<object, SourceResults>;
  nativeProjectPath: string | null; nativeProjectScope: object;
} = import.meta.hot?.data?.sourceCache ?? {
  unscopedProject: {}, resultsByProject: new WeakMap(), nativeProjectPath: null, nativeProjectScope: {},
};
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.sourceCache = runtime; });
  import.meta.hot.accept();
}

export function getSourceWaveformProjectScope(): object {
  const path = projectFileService.getProjectPath();
  if (path !== runtime.nativeProjectPath) { runtime.nativeProjectPath = path; runtime.nativeProjectScope = {}; }
  return projectFileService.getProjectPackageSession()
    ?? projectFileService.getProjectHandle() ?? (path ? runtime.nativeProjectScope : runtime.unscopedProject);
}

function sourceResults(): SourceResults {
  const scope = getSourceWaveformProjectScope();
  let results = runtime.resultsByProject.get(scope);
  if (!results) {
    results = new Map();
    runtime.resultsByProject.set(scope, results);
  }
  return results;
}

/** Reuse completed source work for split clips; never retain decoded PCM. */
export function sourceWaveformAnalysisCacheForFile(file: File, mediaFileId?: string): Map<string, TimelineWaveformAnalysisResult> {
  const sources = sourceResults();
  const sourceKey = JSON.stringify([mediaFileId, file.name, file.size, file.lastModified, file.type]);
  let results = sources.get(sourceKey);
  if (!results) {
    results = new Map();
  }
  sources.delete(sourceKey);
  sources.set(sourceKey, results);
  if (sources.size > 64) sources.delete(sources.keys().next().value!);
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
