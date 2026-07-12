// Maps panel type to actual component
// Note: Effects, Transcript, Analysis are now integrated into PropertiesPanel

import { lazy, Suspense } from 'react';
import type { DockPanel, PreviewPanelData, MultiPreviewPanelData } from '../../types/dock';
import { Preview } from '../preview/Preview';
import { PropertiesPanel } from '../panels/properties';
import { MediaPanel } from '../panels/MediaPanel';
import { Timeline } from '../timeline/Timeline';
import { normalizePreviewPanelSource } from '../../utils/previewPanelSource';
import { importAudioMixerPanel } from '../panels/audio-mixer/audioMixerPanelLoader';

// Lazy-loaded panels: only loaded when the user opens them
// This keeps the initial bundle small by deferring export pipeline,
// AI services and multicam analysis code
const ExportPanel = lazy(() => import('../export/ExportPanel').then(m => ({ default: m.ExportPanel })));
const AudioMixerPanel = lazy(importAudioMixerPanel);
const NodeWorkspacePanel = lazy(() => import('../panels/nodes/NodeWorkspacePanel').then(m => ({ default: m.NodeWorkspacePanel })));
const MultiCamPanel = lazy(() => import('../panels/MultiCamPanel').then(m => ({ default: m.MultiCamPanel })));
const MIDIMappingPanel = lazy(() => import('../panels/MIDIMappingPanel').then(m => ({ default: m.MIDIMappingPanel })));
const TransitionsPanel = lazy(() => import('../panels/TransitionsPanel').then(m => ({ default: m.TransitionsPanel })));
const SAM2Panel = lazy(() => import('../panels/SAM2Panel').then(m => ({ default: m.SAM2Panel })));
const SceneDescriptionPanel = lazy(() => import('../panels/SceneDescriptionPanel').then(m => ({ default: m.SceneDescriptionPanel })));
const WaveformPanel = lazy(() => import('../panels/scopes/WaveformPanel').then(m => ({ default: m.WaveformPanel })));
const HistogramPanel = lazy(() => import('../panels/scopes/HistogramPanel').then(m => ({ default: m.HistogramPanel })));
const VectorscopePanel = lazy(() => import('../panels/scopes/VectorscopePanel').then(m => ({ default: m.VectorscopePanel })));
const MultiPreviewPanel = lazy(() => import('../preview/MultiPreviewPanel').then(m => ({ default: m.MultiPreviewPanel })));
const HistoryPanel = lazy(() => import('../panels/HistoryPanel').then(m => ({ default: m.HistoryPanel })));
const CapturePanel = lazy(() => import('../panels/capture/CapturePanel').then(m => ({ default: m.CapturePanel })));

const DEFAULT_MULTI_PREVIEW_DATA: MultiPreviewPanelData = {
  sourceCompositionId: null,
  slots: [{ compositionId: null }, { compositionId: null }, { compositionId: null }, { compositionId: null }],
  showTransparencyGrid: false,
};

function PanelLoading() {
  return <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading...</div>;
}

interface DockPanelContentProps {
  panel: DockPanel;
}

export function DockPanelContent({ panel }: DockPanelContentProps) {
  switch (panel.type) {
    case 'preview': {
      const previewData = panel.data as PreviewPanelData | undefined;
      return (
        <Preview
          panelId={panel.id}
          source={normalizePreviewPanelSource(previewData)}
          showTransparencyGrid={previewData?.showTransparencyGrid ?? false}
        />
      );
    }
    case 'multi-preview': {
      const mpData = (panel.data as MultiPreviewPanelData | undefined) ?? DEFAULT_MULTI_PREVIEW_DATA;
      return <Suspense fallback={<PanelLoading />}><MultiPreviewPanel panelId={panel.id} data={mpData} /></Suspense>;
    }
    case 'export':
      return <Suspense fallback={<PanelLoading />}><ExportPanel /></Suspense>;
    case 'clip-properties':
      return <PropertiesPanel />;
    case 'audio-mixer':
      return <Suspense fallback={<PanelLoading />}><AudioMixerPanel /></Suspense>;
    case 'node-workspace':
      return <Suspense fallback={<PanelLoading />}><NodeWorkspacePanel /></Suspense>;
    case 'timeline':
      return <Timeline />;
    case 'media':
      return <MediaPanel />;
    case 'history':
      return <Suspense fallback={<PanelLoading />}><HistoryPanel /></Suspense>;
    case 'midi-mapping':
      return <Suspense fallback={<PanelLoading />}><MIDIMappingPanel /></Suspense>;
    case 'multicam':
      return <Suspense fallback={<PanelLoading />}><MultiCamPanel /></Suspense>;
    case 'capture':
      return <Suspense fallback={<PanelLoading />}><CapturePanel /></Suspense>;
    case 'ai-segment':
      return <Suspense fallback={<PanelLoading />}><SAM2Panel /></Suspense>;
    case 'transitions':
      return <Suspense fallback={<PanelLoading />}><TransitionsPanel /></Suspense>;
    case 'scene-description':
      return <Suspense fallback={<PanelLoading />}><SceneDescriptionPanel /></Suspense>;
    case 'scope-waveform':
      return <Suspense fallback={<PanelLoading />}><WaveformPanel /></Suspense>;
    case 'scope-histogram':
      return <Suspense fallback={<PanelLoading />}><HistogramPanel /></Suspense>;
    case 'scope-vectorscope':
      return <Suspense fallback={<PanelLoading />}><VectorscopePanel /></Suspense>;
    default:
      return <div className="panel-placeholder">Unknown panel: {panel.type}</div>;
  }
}
