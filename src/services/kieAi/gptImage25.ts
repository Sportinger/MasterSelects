/** Kie.ai GPT Image 2.5 contract, checked 2026-10-09:
 * https://kie.ai/gpt-image-2-5
 * https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image
 * Shared by the hosted boundary and generation UI; no provider orchestration.
 */
export const GPT_IMAGE_25_MODELS = [
  { id: 'gpt-image-2-5-flare-text-to-image', name: 'GPT Image 2.5 Flare', edit: false },
  { id: 'gpt-image-2-5-flare-image-to-image', name: 'GPT Image 2.5 Flare Edit', edit: true },
  { id: 'gpt-image-2-5-sunburst-text-to-image', name: 'GPT Image 2.5 Sunburst', edit: false },
  { id: 'gpt-image-2-5-sunburst-image-to-image', name: 'GPT Image 2.5 Sunburst Edit', edit: true },
] as const;
export const GPT_IMAGE_25_ASPECT_RATIOS = ['auto', '1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9', '27:16', '16:27', '9:8', '8:9'];
export const GPT_IMAGE_25_1K_ONLY_RATIOS = ['27:16', '16:27', '9:8', '8:9'];
export const GPT_IMAGE_25_RESOLUTIONS = ['1K', '2K', '4K'];
export const GPT_IMAGE_25_BACKGROUNDS = ['auto', 'opaque', 'transparent'] as const;
export type GptImage25Background = typeof GPT_IMAGE_25_BACKGROUNDS[number];
export const GPT_IMAGE_25_USD_PRICING = Object.fromEntries(GPT_IMAGE_25_MODELS.map(({ id }) => [id, { '1K': 0.03, '2K': 0.05, '4K': 0.08 }]));
export function isGptImage25Provider(provider: string): boolean {
  return GPT_IMAGE_25_MODELS.some(model => model.id === provider);
}
export function getGptImage25ValidationError(input: {
  provider: string; prompt: string; aspectRatio?: string; resolution?: string; background?: string; imageInputs?: readonly string[];
}): string | null {
  const model = GPT_IMAGE_25_MODELS.find(model => model.id === input.provider);
  if (!model) return null;
  if (!input.prompt.trim() || input.prompt.length > 20000) return 'GPT Image 2.5 requires a prompt of 1–20,000 characters.';
  const ratio = input.aspectRatio ?? 'auto', resolution = input.resolution ?? '1K';
  if (!GPT_IMAGE_25_ASPECT_RATIOS.includes(ratio)) return 'Unsupported GPT Image 2.5 aspect ratio.';
  if (!GPT_IMAGE_25_RESOLUTIONS.includes(resolution)) return 'GPT Image 2.5 supports 1K, 2K and 4K resolution.';
  if (resolution !== '1K' && GPT_IMAGE_25_1K_ONLY_RATIOS.includes(ratio)) return `${ratio} is only available at 1K with GPT Image 2.5.`;
  if (input.background !== undefined && !GPT_IMAGE_25_BACKGROUNDS.some(value => value === input.background)) return 'Choose Auto, Opaque or Transparent background.';
  const count = input.imageInputs?.length ?? 0;
  if (model.edit && count === 0) return 'Add at least one reference image for GPT Image 2.5 Edit.';
  if (count > 16) return 'GPT Image 2.5 Edit supports at most 16 reference images.';
  if (!model.edit && count > 0) return 'Choose GPT Image 2.5 Edit to use reference images.';
  return null;
}
