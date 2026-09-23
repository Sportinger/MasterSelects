import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { GIB, getMaxScrubRamGB, getReportedMemoryGB } from '../../../services/scrubCacheMemory';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { ResolveInspectorNumberRow } from '../../panels/properties/resolveInspector/ResolveInspectorNumberRow';

export function ScrubCacheSettings() {
  const budget = useSettingsStore((state) => state.scrubCacheRamGB);
  const setBudget = useSettingsStore((state) => state.setScrubCacheRamGB);
  const reported = getReportedMemoryGB();
  const max = getMaxScrubRamGB(reported);
  const [stats, setStats] = useState(() => renderHostPort.getScrubbingCacheStats().ram);
  useEffect(() => {
    const timer = window.setInterval(() => setStats(renderHostPort.getScrubbingCacheStats().ram), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="settings-group resolve-inspector-section">
    <div className="settings-group-title">Performance — Timeline RAM cache</div>
    <p className="settings-hint">
      {reported === null ? 'This browser does not report installed RAM.'
        : `Browser-reported RAM: approximately ${reported} GB (rounded and possibly capped).`}
    </p>
    <ResolveInspectorNumberRow label="RAM budget" ariaLabel="Timeline RAM cache budget"
      value={budget} defaultValue={Math.min(0.5, max)} min={0} max={max} hardMin={0} hardMax={max}
      step={0.25} decimals={2} suffix=" GB" onChange={setBudget} />
    <p className="settings-hint">
      Maximum {max} GB: up to 25% of reported RAM, capped at 4 GB for browser headroom.
      {!reported && ' A conservative 1 GB maximum applies when RAM is unknown.'}
      {' '}Allocates only as frames are cached; 0 disables the RAM cache. Changes apply immediately.
    </p>
    <p className="settings-hint" aria-live="polite">
      RAM used: {((stats?.bytes ?? 0) / GIB).toFixed(2)} GB
      {stats?.reduced && ` · Automatically reduced to ${(stats.maxBytes / GIB).toFixed(2)} GB after a capture failure.`}
      {stats?.captureUnavailable && ' · RAM capture is unavailable in this browser.'}
    </p>
    <p className="settings-hint">
      Keeps scrub frames in RAM with a separate GPU cache of up to 192 MB.
      Applies to non-proxy video scrubbing, not proxy files, effects, or rendered RAM previews.
    </p>
  </div>;
}
