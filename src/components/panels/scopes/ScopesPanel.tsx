import { useState } from 'react';
import { useScopeAnalysis } from './useScopeAnalysis';
import { HistogramScope } from './HistogramScope';
import { VectorscopeScope } from './VectorscopeScope';
import './ScopesPanel.css';

type ScopeTab = 'histogram' | 'vectorscope';

export function ScopesPanel() {
  const [activeTab, setActiveTab] = useState<ScopeTab>('histogram');
  const { histogramData, vectorscopeData } = useScopeAnalysis(activeTab, true);

  return (
    <div className="scopes-panel">
      <div className="scopes-tab-bar">
        <button
          className={`scopes-tab ${activeTab === 'histogram' ? 'active' : ''}`}
          onClick={() => setActiveTab('histogram')}
        >
          Histogram
        </button>
        <button
          className={`scopes-tab ${activeTab === 'vectorscope' ? 'active' : ''}`}
          onClick={() => setActiveTab('vectorscope')}
        >
          Vectorscope
        </button>
      </div>
      <div className="scopes-content">
        {activeTab === 'histogram' ? (
          <HistogramScope data={histogramData} />
        ) : (
          <VectorscopeScope data={vectorscopeData} />
        )}
      </div>
    </div>
  );
}
