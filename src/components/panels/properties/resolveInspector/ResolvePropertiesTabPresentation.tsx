import { useSettingsStore } from '../../../../stores/settingsStore';

type ResolveTabIcon = 'audio' | 'effects' | 'file' | 'image' | 'mask' | 'transition' | 'video';

function ResolveTabGlyph({ icon }: { icon: ResolveTabIcon }) {
  if (icon === 'video') {
    return (
      <>
        <path d="M2 3h12v10H2zM4.5 3v10M11.5 3v10" />
        <path d="M2 5.5h2.5M2 8h2.5M2 10.5h2.5M11.5 5.5H14M11.5 8H14M11.5 10.5H14" />
      </>
    );
  }
  if (icon === 'audio') {
    return <path d="M6 11.5V4.2l6-1.4v7.1M6 5.8l6-1.3M6 11.5c0 1-1 1.7-2.2 1.7S2 12.6 2 11.7 2.9 10 4 10s2 .6 2 1.5Zm6-1.6c0 1-1 1.7-2.2 1.7S8 11 8 10.1s.9-1.7 2-1.7 2 .6 2 1.5Z" />;
  }
  if (icon === 'effects') {
    return (
      <>
        <path d="m3 13 8-8 2 2-8 8-2-2Z" />
        <path d="M8.8 2.2v2.1M7.8 3.2h2.1M13 1.7v2.1M12 2.7h2.1M12.7 9.7v2.1M11.7 10.7h2.1" />
      </>
    );
  }
  if (icon === 'transition') {
    return <path d="M2.5 4h11v8h-11zM2.5 4 8 8l-5.5 4M13.5 4 8 8l5.5 4" />;
  }
  if (icon === 'image') {
    return <path d="M2.5 3h11v10h-11zM4 11l2.7-3 2 2 1.4-1.5 2.4 2.5M5.2 5.7h.1" />;
  }
  if (icon === 'file') {
    return <path d="M2.5 3.5h7.5v9H2.5zM10 5.5h2l1.5 1.7v5.3H10M4.5 6h3.5M4.5 8h3.5M4.5 10h2.5" />;
  }
  return <path d="M3 3h10v10H3zM5 5h6v6H5z" />;
}

function ResolveTabLabel({ icon, label }: { icon: ResolveTabIcon; label: string }) {
  return (
    <span className="resolve-properties-tab-label">
      <svg
        aria-hidden="true"
        className={`resolve-properties-tab-icon resolve-properties-tab-icon--${icon}`}
        viewBox="0 0 16 16"
      >
        <ResolveTabGlyph icon={icon} />
      </svg>
      <span>{label}</span>
    </span>
  );
}

export function PropertiesTabPresentation({
  fallback,
  icon,
  resolveLabel,
}: {
  fallback: string;
  icon: ResolveTabIcon;
  resolveLabel: string;
}) {
  const theme = useSettingsStore(state => state.theme);
  return theme === 'resolve'
    ? <ResolveTabLabel icon={icon} label={resolveLabel} />
    : <>{fallback}</>;
}

export function ResolveOnlyPropertiesTab({
  icon,
  label,
  orderClass,
}: {
  icon: ResolveTabIcon;
  label: string;
  orderClass: string;
}) {
  const theme = useSettingsStore(state => state.theme);
  if (theme !== 'resolve') return null;

  return (
    <button
      aria-label={`${label} inspector is not available for this clip`}
      className={`tab-btn resolve-property-tab resolve-property-tab--unavailable ${orderClass}`}
      disabled
      type="button"
    >
      <ResolveTabLabel icon={icon} label={label} />
    </button>
  );
}
