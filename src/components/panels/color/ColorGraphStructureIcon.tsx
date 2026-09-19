interface ColorGraphStructureIconProps {
  type: string;
}

export function ColorGraphStructureIcon({ type }: ColorGraphStructureIconProps) {
  if (type === 'layer-mixer') {
    return (
      <svg className="color-graph-structure-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 8 7-4 7 4-7 4-7-4Z" strokeWidth="1.25" />
        <path d="m5 12 7 4 7-4M5 16l7 4 7-4" strokeWidth="1.25" />
      </svg>
    );
  }

  if (type === 'parallel-mixer') {
    return (
      <svg className="color-graph-structure-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h2.2c5 0 4.6 10 9.6 10H19" strokeWidth="1.35" />
        <path d="M5 17h2.2c5 0 4.6-10 9.6-10H19" strokeWidth="1.35" />
      </svg>
    );
  }

  if (type === 'key-mixer') {
    return (
      <svg className="color-graph-structure-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9.5" cy="12" r="4.75" strokeWidth="1.2" />
        <circle cx="14.5" cy="12" r="4.75" strokeWidth="1.2" />
        <path d="m7 17 10-10" strokeWidth="1.15" />
      </svg>
    );
  }

  if (type === 'splitter' || type === 'combiner') {
    return (
      <svg className="color-graph-structure-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11.5 5.5v13" stroke="#d9dbde" strokeWidth="1.2" />
        <path className="rgb-cyan" d="M14.5 6.5v11" strokeWidth="2.2" />
        <path className="rgb-red" d="M8 7h1.8" strokeWidth="2.4" />
        <path className="rgb-green" d="M8 12h1.8" strokeWidth="2.4" />
        <path className="rgb-blue" d="M8 17h1.8" strokeWidth="2.4" />
      </svg>
    );
  }

  return (
    <svg className="color-graph-structure-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12M14 8l4 4-4 4" strokeWidth="1.35" />
    </svg>
  );
}
