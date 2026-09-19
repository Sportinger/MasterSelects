export interface SeedancePreproductionErrorPresentation {
  title: string;
  message: string;
  technicalDetails?: string;
}

const DEFAULT_ERROR: SeedancePreproductionErrorPresentation = {
  title: 'Preproduction could not continue',
  message: 'Your story and existing project media are still intact. Return to the last review and try again.',
};

function technical(
  title: string,
  message: string,
  raw: string,
): SeedancePreproductionErrorPresentation {
  return { title, message, technicalDetails: raw };
}

export function presentSeedancePreproductionError(
  error: string | undefined,
): SeedancePreproductionErrorPresentation {
  const raw = error?.trim();
  if (!raw) return DEFAULT_ERROR;

  if (raw.includes('Root-authored scene plans must be accepted by the root orchestrator')) {
    return technical(
      'The scene plan could not be accepted',
      'An internal workflow field was invalid. Your selected story and all project media were preserved, so you can safely return to the review.',
      raw,
    );
  }

  const validation = raw.match(/^The (.+?) could not be validated after \d+ attempts?\./u);
  if (validation) {
    const artifact = validation[1] ?? 'production plan';
    return technical(
      `The ${artifact} still needs a correction`,
      'The planning agent received one focused repair attempt but could not satisfy every required field. Your existing work was preserved.',
      raw,
    );
  }

  if (
    raw.startsWith('[{"code":')
    || raw.includes('did not match the required schema')
    || raw.includes('invalid structured JSON')
  ) {
    return technical(
      'The production plan could not be validated',
      'The planning response was incomplete or internally inconsistent. Your existing work was preserved.',
      raw,
    );
  }

  if (/timed? out|timeout|network|fetch failed|unavailable/iu.test(raw)) {
    return technical(
      'The planning service did not respond',
      'This looks temporary. Your existing work was preserved; return to the last review and try again.',
      raw,
    );
  }

  if (raw.length > 240 || raw.startsWith('{') || raw.startsWith('[')) {
    return technical(DEFAULT_ERROR.title, DEFAULT_ERROR.message, raw);
  }

  return {
    title: DEFAULT_ERROR.title,
    message: raw,
  };
}
