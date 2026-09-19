import { useEffect, useState, type ChangeEvent } from 'react';
import { productAnalytics } from '../../../services/productAnalytics';
import {
  getStoredProductAnalyticsPreference,
  hasProductAnalyticsPrivacySignal,
  setStoredProductAnalyticsPreference,
  subscribeProductAnalyticsPreference,
} from '../../../services/productAnalytics/privacy';

export function ProductAnalyticsSettings() {
  const [storedPreference, setStoredPreference] = useState(getStoredProductAnalyticsPreference);
  const privacySignal = hasProductAnalyticsPrivacySignal();

  useEffect(() => subscribeProductAnalyticsPreference(() => {
    setStoredPreference(getStoredProductAnalyticsPreference());
  }), []);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    setStoredProductAnalyticsPreference(enabled);
    setStoredPreference(enabled);
    if (enabled && !privacySignal) {
      productAnalytics.track('analytics_preference_changed', { enabled: true });
    }
  };

  return (
    <div className="settings-group">
      <div className="settings-group-title">Privacy</div>
      <label className="settings-row">
        <span className="settings-label">Share product usage</span>
        <input
          checked={storedPreference && !privacySignal}
          className="settings-checkbox"
          disabled={privacySignal}
          onChange={handleChange}
          type="checkbox"
        />
      </label>
      <p className="settings-hint">
        Sends allowlisted actions such as import, tutorial, playback, editing, and export outcomes.
        Signed-in events may be linked to your account ID. File names, project content, media,
        and prompts are never included.
        {privacySignal ? ' Your browser privacy signal disables this setting.' : ''}
      </p>
    </div>
  );
}
