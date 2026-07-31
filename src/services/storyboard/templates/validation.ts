import {
  assertStoryboardTemplate,
  type StoryboardTemplate,
} from '../contracts';

const SHARE_EPSILON = 0.000_001;

export function assertStoryboardTemplateSemantics(
  template: StoryboardTemplate,
  path = `template.${template.id}`,
): void {
  assertStoryboardTemplate(template, path);
  if (template.beats.length === 0) {
    throw new Error(`Template ${template.id} must contain at least one beat.`);
  }
  const beatIds = template.beats.map((beat) => beat.id);
  if (beatIds.some((beatId) => !beatId.trim())) {
    throw new Error(`Template ${template.id} contains an empty beat id.`);
  }
  if (new Set(beatIds).size !== beatIds.length) {
    throw new Error(`Template ${template.id} contains duplicate beat ids.`);
  }

  const specified = template.beats.filter(
    (beat) => beat.targetShare !== undefined,
  );
  for (const beat of specified) {
    if (
      !Number.isFinite(beat.targetShare)
      || beat.targetShare! <= 0
      || beat.targetShare! > 1
    ) {
      throw new Error(`Template beat ${beat.id} has an invalid targetShare.`);
    }
  }
  const specifiedTotal = specified.reduce(
    (total, beat) => total + beat.targetShare!,
    0,
  );
  if (specifiedTotal > 1 + SHARE_EPSILON) {
    throw new Error(`Template ${template.id} target shares exceed 100%.`);
  }
  const unspecifiedCount = template.beats.length - specified.length;
  if (
    unspecifiedCount === 0
    && Math.abs(specifiedTotal - 1) > SHARE_EPSILON
  ) {
    throw new Error(
      `Template ${template.id} target shares must total 100% when every beat is specified.`,
    );
  }
  if (unspecifiedCount > 0 && 1 - specifiedTotal <= SHARE_EPSILON) {
    throw new Error(
      `Template ${template.id} leaves no duration for unspecified beats.`,
    );
  }
}
