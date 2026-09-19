import socialBacklogJson from '../../content/social/backlog.json';
import socialConfigJson from '../../content/social/config.json';
import browserProofPostJson from '../../content/social/posts/2026-08-28-browser-proof-01.json';
import type { AppD1Database, Env } from './env';

const allowedAccountStates = new Set([
  'connected',
  'community-only',
  'create',
  'existing-unlinked',
  'later',
  'paused',
]);
const allowedContentStatuses = new Set([
  'idea',
  'needs-input',
  'draft',
  'review',
  'approved',
  'scheduled',
  'published',
  'failed',
  'cancelled',
]);
const externalAccountFields: Record<string, { key: string; label: string }> = {
  facebook: { key: 'pageId', label: 'Page ID' },
  instagram: { key: 'instagramUserId', label: 'Instagram User ID' },
  linkedin: { key: 'authorUrn', label: 'Author URN' },
  threads: { key: 'threadsUserId', label: 'Threads User ID' },
  tiktok: { key: 'openId', label: 'Open ID' },
  youtube: { key: 'channelId', label: 'Channel ID' },
};

interface SocialChannelConfig {
  account: Record<string, string | null> & { state: string };
  credentialEnv: string[];
  enabled: boolean;
  formats: string[];
  priority: number;
  role: string;
}

interface SocialConfig {
  brand: {
    avoid: string[];
    defaultLanguage: string;
    name: string;
    primaryAudience: string[];
    promise: string;
    secondaryLanguage: string;
    voice: string[];
    website: string;
  };
  cadence: { engagement: string; timezone: string; weekly: string[] };
  channels: Record<string, SocialChannelConfig>;
  goals: {
    baseline: Record<string, number>;
    baselineDate: string;
    northStar: string;
    targetDate: string;
    targets: Record<string, number>;
  };
}

interface SocialBacklogItem {
  cta: string;
  formatFamily: string;
  id: string;
  needsFromFounder: string[];
  pillar: string;
  priority: number;
  status: string;
  targetChannels: string[];
  title: string;
}

interface SocialPostPackage {
  assets: Array<{ kind: string; path: string | null; required: boolean; spec: string }>;
  id: string;
  needsFromFounder: string[];
  publishAt: string | null;
  status: string;
  variants: Record<string, unknown>;
}

interface SocialAccountRow {
  account_state: string;
  external_account_id: string | null;
  follower_count: number | null;
  follower_source: 'api' | 'manual' | 'unknown';
  follower_updated_at: string | null;
  handle: string | null;
  notes: string | null;
  platform: string;
  updated_at: string;
}

interface SocialContentRow {
  item_id: string;
  notes: string | null;
  publish_at: string | null;
  status: string;
  updated_at: string;
}

interface SocialInputRow {
  input_key: string;
  item_id: string;
  request_text: string;
  response_text: string | null;
  status: 'done' | 'open' | 'skipped';
  updated_at: string;
}

export interface SocialCenterSnapshot {
  accounts: Array<{
    accountState: string;
    blockers: string[];
    credentialStatus: Array<{ configured: boolean; name: string }>;
    credentialsReady: boolean;
    enabled: boolean;
    externalAccountId: string | null;
    externalAccountIdLabel: string | null;
    followerCount: number | null;
    followerSource: 'api' | 'manual' | 'unknown';
    followerUpdatedAt: string | null;
    formats: string[];
    handle: string | null;
    notes: string | null;
    platform: string;
    postingReady: boolean;
    priority: number;
    role: string;
    updatedAt: string | null;
  }>;
  agentAccess: {
    configured: boolean;
    endpoint: string;
    localCommand: string;
    publishingEnabled: boolean;
  };
  brand: SocialConfig['brand'];
  cadence: SocialConfig['cadence'];
  generatedAt: string;
  goals: SocialConfig['goals'];
  needsFromFounder: Array<{
    inputKey: string;
    itemId: string;
    request: string;
    responseText: string | null;
    status: 'done' | 'open' | 'skipped';
    title: string;
    updatedAt: string | null;
  }>;
  queue: Array<{
    assets: SocialPostPackage['assets'];
    cta: string;
    formatFamily: string;
    id: string;
    notes: string | null;
    pillar: string;
    priority: number;
    publishAt: string | null;
    requirements: SocialCenterSnapshot['needsFromFounder'];
    status: string;
    targetChannels: string[];
    title: string;
    updatedAt: string | null;
    variantChannels: string[];
  }>;
  summary: {
    activeChannels: number;
    automatableChannels: number;
    knownFollowers: number;
    openInputs: number;
    postingReadyChannels: number;
    queuedItems: number;
  };
}

export type SocialCenterUpdate =
  | {
    accountState: string;
    externalAccountId: string | null;
    followerCount: number | null;
    handle: string | null;
    notes: string | null;
    platform: string;
    type: 'account';
  }
  | {
    itemId: string;
    notes: string | null;
    publishAt: string | null;
    status: string;
    type: 'content';
  }
  | {
    inputKey: string;
    responseText: string | null;
    status: 'done' | 'open' | 'skipped';
    type: 'founder-input';
  };

const socialConfig = socialConfigJson as unknown as SocialConfig;
const socialBacklog = socialBacklogJson as unknown as { items: SocialBacklogItem[] };
const postPackages = [browserProofPostJson as unknown as SocialPostPackage];

function envSecretConfigured(env: Env, name: string): boolean {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function founderInputKey(itemId: string, request: string): string {
  let hash = 0x811c9dc5;
  for (const character of request.trim().toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${itemId}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function nullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} is too long.`);
  return normalized || null;
}

function validDateOrNull(value: unknown, field: string): string | null {
  const text = nullableText(value, field, 64);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) throw new Error(`${field} must be a valid date.`);
  return new Date(timestamp).toISOString();
}

function buildSnapshot(
  env: Env,
  accountRows: SocialAccountRow[],
  contentRows: SocialContentRow[],
  inputRows: SocialInputRow[],
  now: Date,
): SocialCenterSnapshot {
  const accountByPlatform = new Map(accountRows.map((row) => [row.platform, row]));
  const contentById = new Map(contentRows.map((row) => [row.item_id, row]));
  const inputByKey = new Map(inputRows.map((row) => [row.input_key, row]));
  const postById = new Map(postPackages.map((post) => [post.id, post]));

  const accounts = Object.entries(socialConfig.channels)
    .map(([platform, config]) => {
      const row = accountByPlatform.get(platform);
      const externalField = externalAccountFields[platform];
      const externalAccountId = row
        ? row.external_account_id
        : externalField ? config.account[externalField.key] ?? null : null;
      const handle = row ? row.handle : config.account.handle ?? null;
      const accountState = row?.account_state ?? config.account.state;
      const credentialStatus = config.credentialEnv.map((name) => ({
        configured: envSecretConfigured(env, name),
        name,
      }));
      const credentialsReady = credentialStatus.every((credential) => credential.configured);
      const blockers: string[] = [];
      if (config.enabled && accountState !== 'community-only') {
        if (!handle) blockers.push('Handle fehlt');
        if (externalField && !externalAccountId) blockers.push(`${externalField.label} fehlt`);
        if (!credentialsReady) blockers.push('Plattform-Zugang fehlt');
        if (accountState !== 'connected') blockers.push('Account noch nicht verbunden');
      }
      return {
        accountState,
        blockers,
        credentialStatus,
        credentialsReady,
        enabled: config.enabled,
        externalAccountId,
        externalAccountIdLabel: externalField?.label ?? null,
        followerCount: row?.follower_count ?? null,
        followerSource: row?.follower_source ?? 'unknown',
        followerUpdatedAt: row?.follower_updated_at ?? null,
        formats: config.formats,
        handle,
        notes: row?.notes ?? null,
        platform,
        postingReady: config.enabled && accountState !== 'community-only' && blockers.length === 0,
        priority: config.priority,
        role: config.role,
        updatedAt: row?.updated_at ?? null,
      };
    })
    .toSorted((left, right) => left.priority - right.priority || left.platform.localeCompare(right.platform));

  const queue = socialBacklog.items
    .map((item) => {
      const post = postById.get(item.id);
      const state = contentById.get(item.id);
      const requestTexts = post?.needsFromFounder?.length ? post.needsFromFounder : item.needsFromFounder;
      const requirements = requestTexts.map((request) => {
        const inputKey = founderInputKey(item.id, request);
        const inputState = inputByKey.get(inputKey);
        return {
          inputKey,
          itemId: item.id,
          request,
          responseText: inputState?.response_text ?? null,
          status: inputState?.status ?? 'open',
          title: item.title,
          updatedAt: inputState?.updated_at ?? null,
        } satisfies SocialCenterSnapshot['needsFromFounder'][number];
      });
      return {
        assets: post?.assets ?? [],
        cta: item.cta,
        formatFamily: item.formatFamily,
        id: item.id,
        notes: state?.notes ?? null,
        pillar: item.pillar,
        priority: item.priority,
        publishAt: state?.publish_at ?? post?.publishAt ?? null,
        requirements,
        status: state?.status ?? post?.status ?? item.status,
        targetChannels: item.targetChannels,
        title: item.title,
        updatedAt: state?.updated_at ?? null,
        variantChannels: post ? Object.keys(post.variants) : [],
      };
    })
    .toSorted((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
  const actionableRequirements = queue.flatMap((item) => (
    ['needs-input', 'draft', 'review', 'approved', 'scheduled'].includes(item.status)
      ? item.requirements
      : []
  ));

  return {
    accounts,
    agentAccess: {
      configured: (env.MS_SOCIAL_AGENT_TOKEN?.trim().length ?? 0) >= 32,
      endpoint: '/api/admin/social/agent-brief',
      localCommand: 'npm run social:status',
      publishingEnabled: false,
    },
    brand: socialConfig.brand,
    cadence: socialConfig.cadence,
    generatedAt: now.toISOString(),
    goals: socialConfig.goals,
    needsFromFounder: actionableRequirements,
    queue,
    summary: {
      activeChannels: accounts.filter((account) => account.enabled).length,
      automatableChannels: accounts.filter((account) => account.enabled && account.accountState !== 'community-only').length,
      knownFollowers: accounts.reduce((sum, account) => sum + (account.followerCount ?? 0), 0),
      openInputs: actionableRequirements.filter((input) => input.status === 'open').length,
      postingReadyChannels: accounts.filter((account) => account.postingReady).length,
      queuedItems: queue.filter((item) => !['published', 'cancelled'].includes(item.status)).length,
    },
  };
}

export async function getSocialCenterSnapshot(
  db: AppD1Database,
  env: Env,
  now = new Date(),
): Promise<SocialCenterSnapshot> {
  const [accounts, content, inputs] = await Promise.all([
    db.prepare('SELECT * FROM social_account_state ORDER BY platform ASC').all<SocialAccountRow>(),
    db.prepare('SELECT * FROM social_content_state ORDER BY updated_at DESC').all<SocialContentRow>(),
    db.prepare('SELECT * FROM social_founder_input_state ORDER BY updated_at DESC').all<SocialInputRow>(),
  ]);
  return buildSnapshot(env, accounts.results, content.results, inputs.results, now);
}

export async function updateSocialCenter(db: AppD1Database, update: SocialCenterUpdate): Promise<void> {
  if (!update || typeof update !== 'object' || typeof update.type !== 'string') {
    throw new Error('Expected a Social Center update.');
  }

  if (update.type === 'account') {
    const config = socialConfig.channels[update.platform];
    if (!config) throw new Error('Unknown social platform.');
    if (!allowedAccountStates.has(update.accountState)) throw new Error('Unsupported account state.');
    const followerCount = update.followerCount;
    if (followerCount !== null && (!Number.isInteger(followerCount) || followerCount < 0 || followerCount > 2_000_000_000)) {
      throw new Error('Follower count must be a positive whole number.');
    }
    await db.prepare(
      `INSERT INTO social_account_state (
         platform, handle, external_account_id, account_state, follower_count,
         follower_source, follower_updated_at, notes, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(platform) DO UPDATE SET
         handle = excluded.handle,
         external_account_id = excluded.external_account_id,
         account_state = excluded.account_state,
         follower_count = excluded.follower_count,
         follower_source = excluded.follower_source,
         follower_updated_at = excluded.follower_updated_at,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    ).bind(
      update.platform,
      nullableText(update.handle, 'Handle', 160),
      nullableText(update.externalAccountId, 'Account ID', 240),
      update.accountState,
      followerCount,
      followerCount === null ? 'unknown' : 'manual',
      followerCount === null ? null : new Date().toISOString(),
      nullableText(update.notes, 'Notes', 2_000),
    ).run();
    return;
  }

  if (update.type === 'content') {
    if (!socialBacklog.items.some((item) => item.id === update.itemId)) throw new Error('Unknown content item.');
    if (!allowedContentStatuses.has(update.status)) throw new Error('Unsupported content status.');
    await db.prepare(
      `INSERT INTO social_content_state (item_id, status, publish_at, notes, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(item_id) DO UPDATE SET
         status = excluded.status,
         publish_at = excluded.publish_at,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    ).bind(
      update.itemId,
      update.status,
      validDateOrNull(update.publishAt, 'Publish date'),
      nullableText(update.notes, 'Notes', 2_000),
    ).run();
    return;
  }

  if (!['done', 'open', 'skipped'].includes(update.status)) throw new Error('Unsupported input status.');
  const knownRequest = socialBacklog.items
    .flatMap((item) => {
      const post = postPackages.find((candidate) => candidate.id === item.id);
      const requests = post?.needsFromFounder?.length ? post.needsFromFounder : item.needsFromFounder;
      return requests.map((request) => ({
        inputKey: founderInputKey(item.id, request),
        itemId: item.id,
        request,
      }));
    })
    .find((request) => request.inputKey === update.inputKey);
  if (!knownRequest) throw new Error('Unknown founder input.');
  await db.prepare(
    `INSERT INTO social_founder_input_state (
       input_key, item_id, request_text, status, response_text, updated_at
     ) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(input_key) DO UPDATE SET
       request_text = excluded.request_text,
       status = excluded.status,
       response_text = excluded.response_text,
       updated_at = excluded.updated_at`,
  ).bind(
    knownRequest.inputKey,
    knownRequest.itemId,
    knownRequest.request,
    update.status,
    nullableText(update.responseText, 'Response', 4_000),
  ).run();
}

export function hasValidSocialAgentToken(request: Request, env: Env): boolean {
  const expected = env.MS_SOCIAL_AGENT_TOKEN?.trim() ?? '';
  const authorization = request.headers.get('Authorization') ?? '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}
