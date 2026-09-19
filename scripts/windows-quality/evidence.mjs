import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CASES, digest, exactPath, hashFile } from './campaign.mjs';

const REQUIRED_BETA = ['hardware', 'active-gpu', 'media-provenance', 'download-name', 'export-path',
  'export-verification', 'audio-verification', 'export', 'frame-sequence', 'export-playback',
  'final-runtime', 'cleanup', 'trace'];
// Validate retained artifacts as well as test status. Never upload or delete evidence here.
export async function validateEvidence(report, output) {
  const root = await exactPath(output), records = [], problems = [];
  async function visit(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) {
        const identity = CASES.find(c => c.title === spec.title && c.project === test.projectName);
        for (const result of test.results || []) {
          const attachments = result.attachments || [];
          if (identity?.file === 'edit-mask-export.spec.ts') {
            for (const name of REQUIRED_BETA) if (!attachments.some(a => a.name === name)) problems.push(`${identity.id}: missing ${name} evidence`);
          }
          for (const attachment of attachments) {
            try {
              if (attachment.path) {
                // Playwright normally emits absolute attachment paths; relative paths are rooted in its cwd.
                const file = path.resolve(attachment.path);
                if (!file.startsWith(root + path.sep)) throw new Error('Attachment outside campaign output');
                await exactPath(file);
                const info = await stat(file);
                if (!info.isFile() || info.size === 0) throw new Error('Missing/empty artifact');
                records.push({ caseId: identity?.id, name: attachment.name, path: path.relative(root, file),
                  bytes: info.size, sha256: await hashFile(file) });
              } else if (typeof attachment.body === 'string' && attachment.body.length > 0) {
                records.push({ caseId: identity?.id, name: attachment.name, inline: true, sha256: digest(attachment.body) });
              } else throw new Error('Missing attachment body/path');
            } catch (error) { problems.push(`${identity?.id ?? 'unknown'} ${attachment.name}: ${String(error)}`); }
          }
        }
      }
      await visit(suite.suites);
    }
  }
  await visit(report.suites);
  return { records, problems, complete: problems.length === 0 };
}

// Receiver outages do not affect local campaign truth. Caller records delivery results,
// retaining the original evidence and verdict; this adapter never sends messages.
export async function readVerdict(claimDirectory) {
  return JSON.parse(await readFile(path.join(claimDirectory, 'verdict.json'), 'utf8'));
}
