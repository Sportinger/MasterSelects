interface FacePersonReference {
  id: string;
  label: string;
  appearances: unknown[];
}

function normalizePersonReference(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveFacePersonReference(
  requested: string | null,
  people: FacePersonReference[],
) {
  if (!requested) {
    return {
      requested: null,
      resolvedPersonId: null,
      resolvedLabel: null,
      matchedBy: null,
      availablePeople: undefined,
    };
  }

  const exactId = people.find(person => person.id === requested);
  const normalizedRequest = normalizePersonReference(requested);
  const normalizedLabelRequest = /^\d+$/.test(normalizedRequest)
    ? `person${normalizedRequest}`
    : normalizedRequest;
  const labelMatch = exactId ?? people.find(
    person => normalizePersonReference(person.label) === normalizedLabelRequest,
  );
  const resolved = exactId ?? labelMatch;

  return {
    requested,
    resolvedPersonId: resolved?.id ?? null,
    resolvedLabel: resolved?.label ?? null,
    matchedBy: exactId ? 'id' : labelMatch ? 'label' : null,
    availablePeople: resolved
      ? undefined
      : people.map(person => ({
          id: person.id,
          label: person.label,
          appearanceCount: person.appearances.length,
        })),
  };
}
