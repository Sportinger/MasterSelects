#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDirectory, '..', '..');
const socialRoot = path.join(repoRoot, 'content', 'social');
const postsRoot = path.join(socialRoot, 'posts');
const configPath = path.join(socialRoot, 'config.json');
const backlogPath = path.join(socialRoot, 'backlog.json');
const identifierPattern = /^[a-z0-9][a-z0-9._:-]*$/;
const allowedStatuses = new Set([
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
const publishAccountKeys = {
  facebook: ['pageId'],
  instagram: ['instagramUserId'],
  linkedin: ['authorUrn'],
  threads: ['threadsUserId'],
  tiktok: ['openId'],
  youtube: ['channelId'],
};

function fail(message, exitCode = 1) {
  console.error(`Social automation: ${message}`);
  process.exitCode = exitCode;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const [rawKey, inlineValue] = argument.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[rawKey] = next;
      index += 1;
    } else {
      options[rawKey] = true;
    }
  }
  return { options, positional };
}

function enabledPublishingChannels(config) {
  return Object.entries(config.channels)
    .filter(([, channel]) => channel.enabled && channel.account.state !== 'community-only')
    .sort((left, right) => left[1].priority - right[1].priority)
    .map(([name]) => name);
}

function trackedUrl(config, platform, campaign, content) {
  const url = new URL(config.brand.website);
  const medium = platform === 'youtube' ? 'video' : 'organic-social';
  url.searchParams.set('utm_source', platform);
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', content);
  return url.toString();
}

async function listPostFiles(explicitPath) {
  if (explicitPath) return [path.resolve(repoRoot, explicitPath)];
  if (!await pathExists(postsRoot)) return [];
  return (await readdir(postsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(postsRoot, entry.name))
    .toSorted();
}

function collectChannelReadiness(config) {
  return enabledPublishingChannels(config).map((name) => {
    const channel = config.channels[name];
    const accountKeys = publishAccountKeys[name] ?? ['handle'];
    return {
      channel: name,
      missingAccountFields: accountKeys.filter((key) => !channel.account[key]),
      missingCredentialEnv: channel.credentialEnv.filter((key) => !process.env[key]),
      state: channel.account.state,
    };
  });
}

function validateTrackedLink(rawValue, platform, post) {
  const issues = [];
  if (typeof rawValue !== 'string' || !rawValue.includes('masterselects.com')) return issues;
  const match = rawValue.match(/https:\/\/www\.masterselects\.com\/[^\s]+/);
  if (!match) return issues;
  let url;
  try {
    url = new URL(match[0]);
  } catch {
    return [`${platform}: contains an invalid MasterSelects URL`];
  }
  const expectations = {
    utm_campaign: post.campaign,
    utm_content: post.id,
    utm_source: platform,
  };
  for (const [key, expected] of Object.entries(expectations)) {
    if (url.searchParams.get(key) !== expected) {
      issues.push(`${platform}: ${key} must be ${expected}`);
    }
  }
  if (!url.searchParams.get('utm_medium')) issues.push(`${platform}: utm_medium is missing`);
  return issues;
}

function validatePost(post, filePath) {
  const issues = [];
  const relativePath = path.relative(repoRoot, filePath);
  if (post.schemaVersion !== 1) issues.push(`${relativePath}: schemaVersion must be 1`);
  for (const field of ['id', 'campaign', 'pillar', 'goal', 'status']) {
    if (typeof post[field] !== 'string' || !post[field].trim()) {
      issues.push(`${relativePath}: ${field} is required`);
    }
  }
  if (post.id && !identifierPattern.test(post.id)) issues.push(`${relativePath}: id is not a safe identifier`);
  if (post.campaign && !identifierPattern.test(post.campaign)) issues.push(`${relativePath}: campaign is not a safe identifier`);
  if (!allowedStatuses.has(post.status)) issues.push(`${relativePath}: unsupported status ${post.status}`);
  if (post.publishAt && Number.isNaN(Date.parse(post.publishAt))) issues.push(`${relativePath}: publishAt is invalid`);
  if (!post.variants || typeof post.variants !== 'object') {
    issues.push(`${relativePath}: variants are required`);
  } else {
    for (const [platform, variant] of Object.entries(post.variants)) {
      if (!variant.format) issues.push(`${relativePath}: ${platform}.format is required`);
      if (!variant.body && !variant.title && !variant.hook) {
        issues.push(`${relativePath}: ${platform} needs body, title, or hook copy`);
      }
      for (const value of Object.values(variant)) {
        if (typeof value === 'string') issues.push(...validateTrackedLink(value, platform, post));
      }
    }
  }
  for (const asset of post.assets ?? []) {
    if (asset.required && !asset.path) issues.push(`${relativePath}: required ${asset.kind} asset has no path`);
  }
  if (['approved', 'scheduled'].includes(post.status) && (post.needsFromFounder?.length ?? 0) > 0) {
    issues.push(`${relativePath}: approved/scheduled posts cannot retain founder input requests`);
  }
  return issues;
}

async function loadPosts(explicitPath) {
  const files = await listPostFiles(explicitPath);
  return Promise.all(files.map(async (filePath) => ({ filePath, post: await readJson(filePath) })));
}

function summarizePosts(posts) {
  const statuses = {};
  for (const { post } of posts) statuses[post.status] = (statuses[post.status] ?? 0) + 1;
  return statuses;
}

async function commandStatus(config, backlog, options) {
  const posts = await loadPosts();
  const readiness = collectChannelReadiness(config);
  const activePostRequests = posts
    .filter(({ post }) => !['published', 'cancelled'].includes(post.status))
    .flatMap(({ post }) => (post.needsFromFounder ?? []).map((request) => ({ postId: post.id, request })));
  const activePostIds = new Set(posts
    .filter(({ post }) => !['published', 'cancelled'].includes(post.status))
    .map(({ post }) => post.id));
  const backlogRequests = backlog.items
    .filter((item) => !activePostIds.has(item.id) && !['published', 'cancelled'].includes(item.status))
    .toSorted((left, right) => left.priority - right.priority)
    .slice(0, 3)
    .map((item) => ({ id: item.id, requests: item.needsFromFounder, title: item.title }));
  const report = {
    northStar: config.goals.northStar,
    targetDate: config.goals.targetDate,
    postStatuses: summarizePosts(posts),
    channelReadiness: readiness,
    needsFromFounder: activePostRequests,
    nextBacklog: backlogRequests,
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('MASTERSELECTS SOCIAL STATUS');
  console.log(`North star: ${report.northStar}`);
  console.log(`90-day target date: ${report.targetDate}`);
  console.log(`Post queue: ${Object.entries(report.postStatuses).map(([key, value]) => `${key}=${value}`).join(', ') || 'empty'}`);
  console.log('\nACCOUNT AND API SETUP');
  for (const item of readiness) {
    const blockers = [
      ...item.missingAccountFields.map((field) => `account.${field}`),
      ...item.missingCredentialEnv,
    ];
    console.log(`- ${item.channel}: ${blockers.length > 0 ? `needs ${blockers.join(', ')}` : 'ready'}`);
  }
  console.log('\nNEEDS FROM ROMAN NOW');
  if (activePostRequests.length === 0) console.log('- Nothing. The active queue has all requested inputs.');
  for (const item of activePostRequests) console.log(`- [${item.postId}] ${item.request}`);
  console.log('\nNEXT CONTENT AFTER THAT');
  for (const item of backlogRequests) {
    console.log(`- ${item.id}: ${item.title}`);
    for (const request of item.requests) console.log(`  - ${request}`);
  }
}

async function commandValidate(explicitPath, options) {
  const posts = await loadPosts(explicitPath);
  if (posts.length === 0) {
    fail('no post packages found');
    return;
  }
  const results = posts.map(({ filePath, post }) => ({
    file: path.relative(repoRoot, filePath),
    issues: validatePost(post, filePath),
  }));
  const issueCount = results.reduce((sum, result) => sum + result.issues.length, 0);
  if (options.json) {
    console.log(JSON.stringify({ issueCount, results }, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.issues.length === 0 ? 'OK' : 'BLOCKED'} ${result.file}`);
      for (const issue of result.issues) console.log(`- ${issue}`);
    }
  }
  if (issueCount > 0) process.exitCode = 1;
}

function makeVariant(config, channel, postId, campaign, format) {
  const url = trackedUrl(config, channel, campaign, postId);
  return {
    format,
    hook: 'TODO: platform-native hook',
    body: 'TODO: platform-native body',
    cta: `Try MasterSelects: ${url}`,
    tags: [],
  };
}

async function commandNew(config, slug, options) {
  if (!slug || !identifierPattern.test(slug)) {
    fail('new requires a lowercase identifier slug, for example browser-proof-02');
    return;
  }
  const campaign = typeof options.campaign === 'string' ? options.campaign : 'first-export-90d';
  if (!identifierPattern.test(campaign)) {
    fail('campaign must be an identifier without spaces');
    return;
  }
  const channels = typeof options.channels === 'string'
    ? options.channels.split(',').map((value) => value.trim()).filter(Boolean)
    : enabledPublishingChannels(config);
  const unknown = channels.filter((channel) => !config.channels[channel]);
  if (unknown.length > 0) {
    fail(`unknown channels: ${unknown.join(', ')}`);
    return;
  }
  const format = typeof options.format === 'string' ? options.format : 'short-video';
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(postsRoot, `${today}-${slug}.json`);
  const post = {
    schemaVersion: 1,
    id: slug,
    campaign,
    pillar: typeof options.pillar === 'string' ? options.pillar : 'proof',
    goal: typeof options.goal === 'string' ? options.goal : 'activated-export',
    status: 'needs-input',
    publishAt: null,
    needsFromFounder: ['TODO: state the smallest exact asset, fact, or decision needed from Roman'],
    assets: [{ kind: 'video', path: null, required: true, spec: '1080x1920 MP4, H.264/AAC' }],
    variants: Object.fromEntries(channels.map((channel) => [
      channel,
      makeVariant(config, channel, slug, campaign, format),
    ])),
  };
  await mkdir(postsRoot, { recursive: true });
  try {
    await writeFile(filePath, `${JSON.stringify(post, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail(`${path.relative(repoRoot, filePath)} already exists`);
      return;
    }
    throw error;
  }
  console.log(`Created ${path.relative(repoRoot, filePath)}`);
  console.log('Fill the founder request, asset path, schedule, and platform copy; then run npm run social:validate.');
}

async function commandPreview(config, explicitPath, options) {
  const posts = await loadPosts(explicitPath);
  if (posts.length !== 1) {
    fail('preview requires exactly one post JSON path');
    return;
  }
  const { post } = posts[0];
  const output = Object.fromEntries(Object.entries(post.variants ?? {}).map(([platform, variant]) => [
    platform,
    { ...variant, trackedUrl: trackedUrl(config, platform, post.campaign, post.id) },
  ]));
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  for (const [platform, variant] of Object.entries(output)) {
    console.log(`\n[${platform.toUpperCase()}] ${variant.format}`);
    for (const field of ['title', 'hook', 'body', 'cta']) {
      if (variant[field]) console.log(`${field}: ${variant[field]}`);
    }
    console.log(`trackedUrl: ${variant.trackedUrl}`);
    if (variant.tags?.length) console.log(`tags: ${variant.tags.map((tag) => `#${tag}`).join(' ')}`);
  }
}

async function commandDispatch(config, explicitPath, options) {
  if (!options['dry-run']) {
    fail('live dispatch is intentionally disabled until OAuth apps and the Cloudflare publisher are configured');
    return;
  }
  const posts = await loadPosts(explicitPath);
  if (posts.length !== 1) {
    fail('dispatch requires exactly one post JSON path');
    return;
  }
  const { filePath, post } = posts[0];
  const issues = validatePost(post, filePath);
  if (!['approved', 'scheduled'].includes(post.status)) issues.push('post status must be approved or scheduled');
  if (issues.length > 0) {
    for (const issue of issues) console.error(`- ${issue}`);
    fail('dispatch blocked');
    return;
  }
  const manifest = Object.entries(post.variants).map(([platform, variant]) => ({
    dispatchKey: `${post.id}:${platform}`,
    platform,
    publishAt: post.publishAt,
    assetPaths: (post.assets ?? []).map((asset) => asset.path).filter(Boolean),
    trackedUrl: trackedUrl(config, platform, post.campaign, post.id),
    variant,
  }));
  console.log(JSON.stringify({ dryRun: true, manifest }, null, 2));
}

async function commandRemoteBrief(options) {
  const token = process.env.MS_SOCIAL_AGENT_TOKEN?.trim();
  if (!token) {
    fail('remote-brief requires MS_SOCIAL_AGENT_TOKEN');
    return;
  }
  const baseUrl = typeof options.url === 'string'
    ? options.url
    : process.env.MS_SOCIAL_CENTER_URL?.trim() || 'https://www.masterselects.com';
  let endpoint;
  try {
    endpoint = new URL('/api/admin/social/agent-brief', baseUrl);
  } catch {
    fail('remote-brief received an invalid Social Center URL');
    return;
  }
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(payload.message || `Social Center returned ${response.status}`);
    return;
  }
  console.log(JSON.stringify(payload.brief, null, 2));
}

function printHelp() {
  console.log(`MasterSelects social automation

Commands:
  status [--json]                         Show account blockers and exact founder inputs.
  new <slug> [--campaign X] [--channels a,b] [--format X]
                                          Create a platform-specific post package.
  validate [post.json] [--json]           Enforce package, asset, approval, and UTM rules.
  preview <post.json> [--json]             Render the platform variants and tracked URLs.
  dispatch <post.json> --dry-run           Build the deterministic future publish manifest.
  remote-brief [--url https://...]         Read the persistent Admin Social Center brief.

Live publishing is not enabled until platform OAuth setup and the Cloudflare
publisher are complete. No command prints credential values.`);
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const { options, positional } = parseArguments(rest);
  if (command === 'remote-brief') return commandRemoteBrief(options);
  const [config, backlog] = await Promise.all([readJson(configPath), readJson(backlogPath)]);
  if (command === 'status' || command === 'brief') return commandStatus(config, backlog, options);
  if (command === 'validate') return commandValidate(positional[0], options);
  if (command === 'new') return commandNew(config, positional[0], options);
  if (command === 'preview') return commandPreview(config, positional[0], options);
  if (command === 'dispatch') return commandDispatch(config, positional[0], options);
  printHelp();
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
