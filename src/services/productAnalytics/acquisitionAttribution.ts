import type { ProductAnalyticsProperties } from './catalog';

const SOCIAL_SOURCES = new Set([
  'bluesky',
  'discord',
  'facebook',
  'instagram',
  'linkedin',
  'reddit',
  'threads',
  'tiktok',
  'x',
  'youtube',
]);

const ACQUISITION_MEDIA = new Set([
  'community',
  'email',
  'organic-social',
  'referral',
  'social',
  'video',
]);

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]*$/i;

function boundedIdentifier(value: string | null, maximumLength: number): string | undefined {
  const normalized = value?.trim().toLowerCase().slice(0, maximumLength);
  return normalized && IDENTIFIER.test(normalized) ? normalized : undefined;
}

export function readAcquisitionAttribution(
  search: string | URLSearchParams,
): ProductAnalyticsProperties {
  const params = typeof search === 'string'
    ? new URLSearchParams(search)
    : search;
  const source = boundedIdentifier(params.get('utm_source'), 24);
  const medium = boundedIdentifier(params.get('utm_medium'), 24);
  const campaign = boundedIdentifier(params.get('utm_campaign'), 64);
  const content = boundedIdentifier(params.get('utm_content'), 64);

  return {
    ...(source && SOCIAL_SOURCES.has(source) ? { acquisition_source: source } : {}),
    ...(medium && ACQUISITION_MEDIA.has(medium) ? { acquisition_medium: medium } : {}),
    ...(campaign ? { acquisition_campaign: campaign } : {}),
    ...(content ? { acquisition_content: content } : {}),
  };
}
