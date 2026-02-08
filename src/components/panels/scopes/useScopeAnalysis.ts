import { useState, useEffect, useRef, useCallback } from 'react';
import { useEngineStore } from '../../../stores/engineStore';
import {
  computeHistogram,
  computeVectorscope,
  type HistogramData,
} from '../../../engine/analysis/ScopeAnalyzer';

const ANALYSIS_INTERVAL = 100; // ~10fps
const PIXEL_STEP = 4; // sample every 4th pixel in each dimension
const VECTORSCOPE_SIZE = 256;

export interface ScopeAnalysisResult {
  histogramData: HistogramData | null;
  vectorscopeData: ImageData | null;
  isAnalyzing: boolean;
}

export function useScopeAnalysis(
  activeTab: 'histogram' | 'vectorscope',
  visible: boolean
): ScopeAnalysisResult {
  const isEngineReady = useEngineStore((s) => s.isEngineReady);
  const [histogramData, setHistogramData] = useState<HistogramData | null>(null);
  const [vectorscopeData, setVectorscopeData] = useState<ImageData | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const lastAnalysisTime = useRef(0);
  const rafId = useRef(0);
  const runningRef = useRef(false);

  const analyze = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsAnalyzing(true);

    try {
      const { engine } = await import('../../../engine/WebGPUEngine');
      const pixels = await engine.readPixels();
      if (!pixels) {
        runningRef.current = false;
        setIsAnalyzing(false);
        return;
      }

      const { width, height } = engine.getOutputDimensions();

      if (activeTab === 'histogram') {
        const data = computeHistogram(pixels, width, height, PIXEL_STEP);
        setHistogramData(data);
      } else {
        const data = computeVectorscope(pixels, width, height, PIXEL_STEP, VECTORSCOPE_SIZE);
        setVectorscopeData(data);
      }
    } catch {
      // Engine not ready or GPU error — silently skip
    } finally {
      runningRef.current = false;
      setIsAnalyzing(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!visible || !isEngineReady) return;

    let cancelled = false;

    const tick = (timestamp: number) => {
      if (cancelled) return;
      if (timestamp - lastAnalysisTime.current >= ANALYSIS_INTERVAL) {
        lastAnalysisTime.current = timestamp;
        analyze();
      }
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId.current);
    };
  }, [visible, isEngineReady, analyze]);

  return { histogramData, vectorscopeData, isAnalyzing };
}
