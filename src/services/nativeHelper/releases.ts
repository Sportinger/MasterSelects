export const NATIVE_HELPER_TARGET_VERSION = '0.3.14';
export const NATIVE_HELPER_RELEASES_URL = 'https://github.com/Sportinger/MasterSelects/releases';

const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/Sportinger/MasterSelects/releases?per_page=20';
const NATIVE_HELPER_TAG_PREFIX = 'native-helper-v';
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;

export type NativeHelperPublishedRelease = {
  version: string;
  url: string;
  publishedAt: string | null;
};

type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  assets?: unknown[];
};

let cachedPublishedRelease: NativeHelperPublishedRelease | null | undefined;
let cachedPublishedReleaseFetchedAt = 0;
let inFlightPublishedReleaseRequest: Promise<NativeHelperPublishedRelease | null> | null = null;

export function normalizeNativeHelperVersion(version: string | null | undefined): string | null {
  if (!version) {
    return null;
  }

  const normalized = version.trim().replace(/^v/i, '');
  return /^\d+(?:\.\d+)*$/.test(normalized) ? normalized : null;
}

export function compareNativeHelperVersions(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const normalizedLeft = normalizeNativeHelperVersion(left);
  const normalizedRight = normalizeNativeHelperVersion(right);

  if (normalizedLeft === normalizedRight) {
    return 0;
  }
  if (!normalizedLeft) {
    return normalizedRight ? -1 : 0;
  }
  if (!normalizedRight) {
    return 1;
  }

  const leftParts = normalizedLeft.split('.').map(Number);
  const rightParts = normalizedRight.split('.').map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index++) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

export function selectLatestPublishedNativeHelperRelease(
  releases: GitHubRelease[],
): NativeHelperPublishedRelease | null {
  const latest = releases
    .filter((release) => {
      if (release.draft) {
        return false;
      }
      if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
        return false;
      }
      if (!release.tag_name.startsWith(NATIVE_HELPER_TAG_PREFIX)) {
        return false;
      }
      return Array.isArray(release.assets) && release.assets.length > 0;
    })
    .sort((left, right) => {
      const publishedDelta =
        (Date.parse(right.published_at ?? '') || 0) - (Date.parse(left.published_at ?? '') || 0);

      if (publishedDelta !== 0) {
        return publishedDelta;
      }

      const leftVersion = left.tag_name?.replace(NATIVE_HELPER_TAG_PREFIX, '');
      const rightVersion = right.tag_name?.replace(NATIVE_HELPER_TAG_PREFIX, '');
      return compareNativeHelperVersions(rightVersion, leftVersion);
    })[0];

  if (!latest?.tag_name || !latest.html_url) {
    return null;
  }

  return {
    version: latest.tag_name.replace(NATIVE_HELPER_TAG_PREFIX, ''),
    url: latest.html_url,
    publishedAt: latest.published_at ?? null,
  };
}

export async function fetchLatestPublishedNativeHelperRelease(
  options: { forceRefresh?: boolean } = {},
): Promise<NativeHelperPublishedRelease | null> {
  const { forceRefresh = false } = options;
  const now = Date.now();
  const cacheIsFresh =
    !forceRefresh &&
    cachedPublishedRelease !== undefined &&
    now - cachedPublishedReleaseFetchedAt < RELEASE_CACHE_TTL_MS;

  if (cacheIsFresh) {
    return cachedPublishedRelease ?? null;
  }

  if (inFlightPublishedReleaseRequest && !forceRefresh) {
    return inFlightPublishedReleaseRequest;
  }

  inFlightPublishedReleaseRequest = (async () => {
    try {
      const response = await fetch(GITHUB_RELEASES_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      });

      if (!response.ok) {
        cachedPublishedRelease = null;
        cachedPublishedReleaseFetchedAt = Date.now();
        return null;
      }

      const releases = await response.json() as GitHubRelease[];
      const latest = selectLatestPublishedNativeHelperRelease(releases);
      cachedPublishedRelease = latest;
      cachedPublishedReleaseFetchedAt = Date.now();
      return latest;
    } catch {
      cachedPublishedRelease = null;
      cachedPublishedReleaseFetchedAt = Date.now();
      return null;
    } finally {
      inFlightPublishedReleaseRequest = null;
    }
  })();

  return inFlightPublishedReleaseRequest;
}
