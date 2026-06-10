import type { CatalogEntry } from './types';
import type { RefineFlashBoardPromptInput, PromptReferenceDescriptor } from './FlashBoardPromptRefinerTypes';

export function getOutputTypeLabel(entry: CatalogEntry): string {
  if (entry.outputType === 'image' || entry.supportsTextToImage) {
    return 'image';
  }

  if (entry.outputType === 'audio' || entry.supportsTextToAudio) {
    return 'audio';
  }

  return 'video';
}

export function isSunoTarget(input: Pick<RefineFlashBoardPromptInput, 'entry' | 'service' | 'providerId'>): boolean {
  return input.entry.service === 'suno'
    || input.service === 'suno'
    || input.providerId.toLowerCase().includes('suno');
}

function getTargetModelGuidance(
  input: Pick<
    RefineFlashBoardPromptInput,
    'entry' | 'service' | 'providerId' | 'multiShots' | 'generateAudio' | 'sunoInstrumental'
  >,
): string {
  const outputType = getOutputTypeLabel(input.entry);
  const providerId = input.providerId.toLowerCase();

  if (isSunoTarget(input)) {
    const lyricGuidance = input.sunoInstrumental
      ? 'Instrumental mode is enabled: write arrangement-focused lyrics text with section markers and no singable vocal lines.'
      : 'Write singable, production-ready lyrics with a clear structure, hook, concrete imagery, and natural English phrasing.';

    return [
      'Optimize for Suno music generation.',
      lyricGuidance,
      'Style must be concise and high-signal: genre, era, mood, tempo feel, instrumentation, vocal character, mix/production cues, and a useful structure hint.',
      'Negative tags must be short comma-separated failure modes that improve generation quality.',
      'Avoid generic filler such as "good song", "high quality", "best", or vague mood-only prompts.',
    ].join('\n');
  }

  if (outputType === 'image') {
    const referenceGuidance = providerId.includes('nano-banana')
      ? 'Nano Banana 2 is reference-aware: explicitly preserve identity, composition, materials, text, logos, style cues, and spatial relationships from relevant REF images unless the user asks to change them.'
      : 'Use reference images as visual anchors and name the exact REF labels when a subject, style, composition, or object should be carried forward.';

    return [
      'Optimize for a single still-image generation prompt.',
      referenceGuidance,
      'Describe the final image, not a process. Include subject, composition, environment, lighting, lens/framing, material/detail fidelity, color palette, and desired finish.',
      'Do not include video motion, shot lists, duration, music, or audio instructions.',
    ].join('\n');
  }

  if (outputType === 'video') {
    const multiShotGuidance = input.multiShots
      ? 'Multi-shot is enabled: write a compact global style and continuity prompt for the whole sequence, not per-shot prompts.'
      : 'Write one coherent shot prompt with clear beginning, motion, camera behavior, subject action, environment, and ending state.';
    const audioGuidance = input.generateAudio
      ? 'Sound generation is enabled: include concise diegetic sound cues only when they support the scene.'
      : 'Do not add soundtrack or sound-design instructions.';

    if (providerId.includes('kling')) {
      return [
        'Optimize for Kling-style image/video generation.',
        'Prioritize physically plausible subject motion, cinematic camera movement, clear temporal progression, and stable identity from referenced frames.',
        multiShotGuidance,
        audioGuidance,
      ].join('\n');
    }

    if (providerId.includes('seedance')) {
      return [
        'Optimize for ByteDance Seedance 2.0 video generation.',
        'Seedance responds best to concise cinematic direction: subject identity, action, scene progression, camera motion, composition, lighting, style, and a clear final state.',
        'When REF audio is supplied, treat it as the performance, speech, mouth-shape, rhythm, or timing driver. Do not describe it as background music unless the user asks for that. Audio references must be paired with at least one visual IN/REF image or video anchor.',
        'When REF image or video media is supplied, preserve the requested identity, pose, costume, object, motion, or scene cues and name the relevant REF labels explicitly.',
        'Seedance first/last-frame mode and multimodal reference mode are separate. If multiple REF media are present, write natural reference guidance instead of relying on strict first-frame wording.',
        'Avoid long shot lists, unsupported parameter names, negative prompts, or soundtrack instructions.',
        multiShotGuidance,
        audioGuidance,
      ].join('\n');
    }

    return [
      'Optimize for a video generation prompt.',
      multiShotGuidance,
      'Include subject action, camera movement, scene progression, lighting, style, and continuity with referenced frames.',
      audioGuidance,
    ].join('\n');
  }

  return [
    'Optimize for a text-to-speech prompt.',
    'Rewrite the text in clear English while preserving the speaker intent and avoiding image-generation language.',
  ].join('\n');
}

export function buildFlashBoardPromptRefinerInstructions(
  input: Pick<
    RefineFlashBoardPromptInput,
    'entry' | 'service' | 'providerId' | 'version' | 'multiShots' | 'generateAudio' | 'sunoInstrumental'
  >,
): string {
  const outputType = getOutputTypeLabel(input.entry);

  if (isSunoTarget(input)) {
    return [
      'You are MasterSelects Suno Prompt Refiner. Your job is to turn a draft song idea into excellent English Suno inputs.',
      '',
      'Success criteria:',
      '- Preserve the user intent, but make the song more vivid, singable, and model-fit.',
      '- Write lyrics that have a clear musical structure and avoid bland placeholder lines.',
      '- Write a compact style field that steers genre, vocals, arrangement, production, and mood.',
      '- Write negative tags that reduce bad artifacts without fighting the intended style.',
      '- The output must be in English even when the user draft is not.',
      '- Do not mention OpenAI, GPT, prompt rewriting, or this refinement step.',
      '',
      'Return exactly these labelled sections and nothing else:',
      'LYRICS:',
      'STYLE:',
      'NEGATIVE:',
      '',
      `Target: ${input.entry.name}`,
      `Provider: ${input.service}/${input.providerId}`,
      `Version: ${input.version}`,
      `Output type: ${outputType}`,
      '',
      getTargetModelGuidance(input),
    ].join('\n');
  }

  return [
    'You are MasterSelects Prompt Refiner. Your only job is to rewrite a user draft into one excellent English generation prompt for the selected target model.',
    '',
    'Success criteria:',
    '- Preserve the user intent and improve specificity, clarity, and model fit.',
    '- Use the supplied reference images as evidence. Do not invent identity, text, brands, logos, objects, or composition details that are not visible or requested.',
    '- Keep useful REF labels such as REF 1 or START when the downstream model should use a specific reference.',
    '- Return a final prompt only; no analysis, no alternatives, no markdown.',
    '- The final prompt must be in English even when the user draft is not.',
    '- Do not mention OpenAI, GPT, prompt rewriting, or this refinement step.',
    '',
    `Target: ${input.entry.name}`,
    `Provider: ${input.service}/${input.providerId}`,
    `Version: ${input.version}`,
    `Output type: ${outputType}`,
    '',
    getTargetModelGuidance(input),
  ].join('\n');
}

export function buildFlashBoardPromptRefinerUserText(
  input: Pick<
    RefineFlashBoardPromptInput,
    | 'prompt'
    | 'entry'
    | 'service'
    | 'providerId'
    | 'mode'
    | 'duration'
    | 'aspectRatio'
    | 'imageSize'
    | 'generateAudio'
    | 'multiShots'
    | 'sunoStyle'
    | 'sunoNegativeTags'
    | 'sunoInstrumental'
    | 'sunoCustomMode'
    | 'sunoVocalGender'
    | 'sunoStyleWeight'
    | 'sunoWeirdnessConstraint'
    | 'sunoAudioWeight'
  >,
  references: PromptReferenceDescriptor[],
): string {
  const outputType = getOutputTypeLabel(input.entry);
  const referenceLines = references.length > 0
    ? references.map((reference) => {
        const mediaType = reference.mediaType ? ` ${reference.mediaType}` : '';
        return `- ${reference.label} (${reference.role}${mediaType}): ${reference.displayName}`;
      }).join('\n')
    : '- none';

  if (isSunoTarget(input)) {
    return [
      'Rewrite the Suno inputs for the selected music generation settings.',
      '',
      `Current lyrics / song idea:\n${input.prompt.trim() || '(empty)'}`,
      '',
      `Current style:\n${input.sunoStyle?.trim() || '(empty)'}`,
      '',
      `Current negative tags:\n${input.sunoNegativeTags?.trim() || '(empty)'}`,
      '',
      'Suno settings:',
      `- Mode: ${input.sunoCustomMode ? 'custom' : 'simple'}`,
      `- Instrumental: ${input.sunoInstrumental ? 'yes' : 'no'}`,
      `- Vocal gender: ${input.sunoVocalGender || 'auto'}`,
      `- Style weight: ${input.sunoStyleWeight ?? 'default'}`,
      `- Weirdness: ${input.sunoWeirdnessConstraint ?? 'default'}`,
      `- Audio weight: ${input.sunoAudioWeight ?? 'default'}`,
      '',
      'Reference images supplied in order:',
      referenceLines,
      '',
      'Return exactly three labelled sections: LYRICS, STYLE, NEGATIVE.',
    ].join('\n');
  }

  return [
    'Rewrite the draft prompt for the selected generation settings.',
    '',
    `Current draft prompt:\n${input.prompt.trim() || '(empty: infer a useful prompt from the reference images and generation settings)'}`,
    '',
    'Generation settings:',
    `- Output: ${outputType}`,
    `- Aspect ratio: ${input.aspectRatio}`,
    `- Duration: ${outputType === 'video' ? `${input.duration}s` : 'not applicable'}`,
    `- Image size: ${outputType === 'image' ? input.imageSize : 'not applicable'}`,
    `- Mode: ${input.mode || 'default'}`,
    `- Sound: ${input.generateAudio ? 'enabled' : 'disabled'}`,
    `- Multi-shot: ${input.multiShots ? 'enabled' : 'disabled'}`,
    '',
    'Reference images supplied in order:',
    referenceLines,
    '',
    'Return JSON with a single field named "prompt".',
  ].join('\n');
}

export function buildFlashBoardPromptRefinerStreamingUserText(
  input: Pick<
    RefineFlashBoardPromptInput,
    | 'prompt'
    | 'entry'
    | 'service'
    | 'providerId'
    | 'mode'
    | 'duration'
    | 'aspectRatio'
    | 'imageSize'
    | 'generateAudio'
    | 'multiShots'
    | 'sunoStyle'
    | 'sunoNegativeTags'
    | 'sunoInstrumental'
    | 'sunoCustomMode'
    | 'sunoVocalGender'
    | 'sunoStyleWeight'
    | 'sunoWeirdnessConstraint'
    | 'sunoAudioWeight'
  >,
  references: PromptReferenceDescriptor[],
): string {
  if (isSunoTarget(input)) {
    return buildFlashBoardPromptRefinerUserText(input, references);
  }

  return [
    buildFlashBoardPromptRefinerUserText(input, references)
      .replace(
        'Return JSON with a single field named "prompt".',
        'Return the final refined English prompt text only. Do not wrap it in JSON, quotes, markdown, or commentary.',
      ),
  ].join('\n');
}
