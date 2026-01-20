/**
 * MasterSelects Native Helper
 *
 * WebSocket server for native operations like YouTube downloads.
 * Connects to the web app via ws://127.0.0.1:9876
 */

import { WebSocketServer } from 'ws';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, statSync } from 'fs';
import { homedir, platform, release } from 'os';
import { join, basename } from 'path';

const PORT = 9876;
const VERSION = '1.0.0';

// Download directory
const DOWNLOAD_DIR = join(homedir(), 'Movies', 'MasterSelects Downloads');

// Ensure download directory exists
if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Check if yt-dlp is installed
function checkYtDlp() {
  try {
    execSync('which yt-dlp', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Get yt-dlp version
function getYtDlpVersion() {
  try {
    return execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
  } catch {
    return 'not installed';
  }
}

const hasYtDlp = checkYtDlp();
const ytDlpVersion = getYtDlpVersion();

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║       MasterSelects Native Helper v' + VERSION + '        ║');
console.log('╠═══════════════════════════════════════════════════╣');
console.log(`║  Port: ${PORT}                                       ║`);
console.log(`║  yt-dlp: ${hasYtDlp ? 'installed (' + ytDlpVersion + ')' : 'NOT FOUND'}`.padEnd(54) + '║');
console.log(`║  Downloads: ~/Movies/MasterSelects Downloads       ║`);
console.log('╚═══════════════════════════════════════════════════╝');

if (!hasYtDlp) {
  console.log('\n⚠️  yt-dlp not found! Install with: brew install yt-dlp\n');
}

// Create WebSocket server
const wss = new WebSocketServer({ port: PORT });

console.log(`\n✓ WebSocket server listening on ws://127.0.0.1:${PORT}\n`);

// Active downloads
const activeDownloads = new Map();

wss.on('connection', (ws) => {
  console.log('[+] Client connected');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[CMD] ${message.cmd} (id: ${message.id})`);

      switch (message.cmd) {
        case 'ping':
          ws.send(JSON.stringify({ id: message.id, ok: true, pong: true }));
          break;

        case 'info':
          ws.send(JSON.stringify({
            id: message.id,
            ok: true,
            // SystemInfo format expected by the app
            version: VERSION,
            ffmpeg_version: ytDlpVersion,
            hw_accel: hasYtDlp ? ['yt-dlp'] : [],
            cache_used_mb: 0,
            cache_max_mb: 1000,
            open_files: activeDownloads.size,
            // Extra info
            platform: platform(),
            release: release(),
            download_dir: DOWNLOAD_DIR,
          }));
          break;

        case 'download_youtube':
          await handleYouTubeDownload(ws, message);
          break;

        case 'list_formats':
          await handleListFormats(ws, message);
          break;

        case 'get_file':
          handleGetFile(ws, message);
          break;

        case 'cancel_download':
          handleCancelDownload(ws, message);
          break;

        default:
          ws.send(JSON.stringify({
            id: message.id,
            ok: false,
            error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${message.cmd}` }
          }));
      }
    } catch (err) {
      console.error('[ERROR] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[-] Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('[ERROR] WebSocket error:', err);
  });
});

/**
 * Handle list formats request
 */
async function handleListFormats(ws, message) {
  const { id, url } = message;

  if (!hasYtDlp) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'YT_DLP_NOT_FOUND', message: 'yt-dlp is not installed' }
    }));
    return;
  }

  if (!url) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'INVALID_URL', message: 'No URL provided' }
    }));
    return;
  }

  console.log(`[FORMATS] Fetching: ${url}`);

  try {
    // Get JSON info including formats
    const result = execSync(`yt-dlp -J --no-playlist "${url}"`, {
      encoding: 'utf-8',
      timeout: 30000
    });

    const info = JSON.parse(result);

    // Extract useful format info
    const formats = (info.formats || [])
      .filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
      .map(f => ({
        format_id: f.format_id,
        ext: f.ext,
        resolution: f.resolution || (f.height ? `${f.width}x${f.height}` : 'audio only'),
        fps: f.fps || null,
        vcodec: f.vcodec !== 'none' ? f.vcodec : null,
        acodec: f.acodec !== 'none' ? f.acodec : null,
        filesize: f.filesize || f.filesize_approx || null,
        tbr: f.tbr || null, // total bitrate
        format_note: f.format_note || '',
        hasVideo: f.vcodec !== 'none',
        hasAudio: f.acodec !== 'none',
      }));

    // Group into video+audio, video-only, audio-only
    const combined = formats.filter(f => f.hasVideo && f.hasAudio);
    const videoOnly = formats.filter(f => f.hasVideo && !f.hasAudio);
    const audioOnly = formats.filter(f => !f.hasVideo && f.hasAudio);

    // Create recommended options
    const recommendations = [];

    // Best quality (will need merge)
    const bestVideo = videoOnly.find(f => f.resolution?.includes('2160') || f.resolution?.includes('1440')) ||
                      videoOnly.find(f => f.resolution?.includes('1080')) ||
                      videoOnly[0];
    const bestAudio = audioOnly.find(f => f.acodec?.includes('opus')) ||
                      audioOnly.find(f => f.ext === 'm4a') ||
                      audioOnly[0];

    if (bestVideo && bestAudio) {
      recommendations.push({
        id: `${bestVideo.format_id}+${bestAudio.format_id}`,
        label: `Best Quality (${bestVideo.resolution})`,
        resolution: bestVideo.resolution,
        vcodec: bestVideo.vcodec,
        acodec: bestAudio.acodec,
        needsMerge: true,
      });
    }

    // 1080p option
    const video1080 = videoOnly.find(f => f.resolution?.includes('1080'));
    if (video1080 && bestAudio) {
      recommendations.push({
        id: `${video1080.format_id}+${bestAudio.format_id}`,
        label: '1080p HD',
        resolution: '1920x1080',
        vcodec: video1080.vcodec,
        acodec: bestAudio.acodec,
        needsMerge: true,
      });
    }

    // 720p option
    const video720 = videoOnly.find(f => f.resolution?.includes('720'));
    if (video720 && bestAudio) {
      recommendations.push({
        id: `${video720.format_id}+${bestAudio.format_id}`,
        label: '720p HD',
        resolution: '1280x720',
        vcodec: video720.vcodec,
        acodec: bestAudio.acodec,
        needsMerge: true,
      });
    }

    // Best combined (no merge needed)
    const bestCombined = combined
      .sort((a, b) => {
        const resA = parseInt(a.resolution) || 0;
        const resB = parseInt(b.resolution) || 0;
        return resB - resA;
      })[0];

    if (bestCombined) {
      recommendations.push({
        id: bestCombined.format_id,
        label: `Quick Download (${bestCombined.resolution})`,
        resolution: bestCombined.resolution,
        vcodec: bestCombined.vcodec,
        acodec: bestCombined.acodec,
        needsMerge: false,
      });
    }

    // Audio only
    if (bestAudio) {
      recommendations.push({
        id: bestAudio.format_id,
        label: 'Audio Only (Best)',
        resolution: 'audio',
        vcodec: null,
        acodec: bestAudio.acodec,
        needsMerge: false,
      });
    }

    ws.send(JSON.stringify({
      id,
      ok: true,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      recommendations,
      allFormats: formats,
    }));

  } catch (err) {
    console.error(`[FORMATS] Error: ${err.message}`);
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'FORMAT_ERROR', message: err.message }
    }));
  }
}

/**
 * Handle YouTube download request
 */
async function handleYouTubeDownload(ws, message) {
  const { id, url, format_id } = message;

  if (!hasYtDlp) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'YT_DLP_NOT_FOUND', message: 'yt-dlp is not installed. Run: brew install yt-dlp' }
    }));
    return;
  }

  if (!url) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'INVALID_URL', message: 'No URL provided' }
    }));
    return;
  }

  console.log(`[DOWNLOAD] Starting: ${url} (format: ${format_id || 'best'})`);

  // Output template - use video title
  const outputTemplate = join(DOWNLOAD_DIR, '%(title)s.%(ext)s');

  // Determine format string
  const formatStr = format_id || 'bestvideo+bestaudio/best';

  // yt-dlp arguments
  const args = [
    url,
    '-f', formatStr,
    '-o', outputTemplate,
    '--no-playlist',
    '--progress',
    '--newline',
    '--no-warnings',
    '--merge-output-format', 'mp4',  // Ensure video+audio merge to mp4
    '--embed-thumbnail',              // Embed thumbnail if available
    '--embed-metadata',               // Embed metadata
  ];

  const process = spawn('yt-dlp', args);
  activeDownloads.set(id, process);

  let outputPath = null;
  let lastProgress = 0;

  process.stdout.on('data', (data) => {
    const line = data.toString().trim();

    // Parse progress
    const progressMatch = line.match(/(\d+\.?\d*)%/);
    if (progressMatch) {
      const progress = parseFloat(progressMatch[1]);
      // Only send progress updates every 5%
      if (progress - lastProgress >= 5 || progress >= 100) {
        lastProgress = progress;
        ws.send(JSON.stringify({
          id,
          progress: progress / 100,
          status: 'downloading'
        }));
      }
    }

    // Parse destination
    const destMatch = line.match(/\[download\] Destination: (.+)$/);
    if (destMatch) {
      outputPath = destMatch[1];
    }

    // Parse merge destination
    const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"$/);
    if (mergeMatch) {
      outputPath = mergeMatch[1];
    }

    // Already downloaded
    const alreadyMatch = line.match(/\[download\] (.+) has already been downloaded/);
    if (alreadyMatch) {
      outputPath = alreadyMatch[1];
    }
  });

  process.stderr.on('data', (data) => {
    console.error(`[yt-dlp stderr] ${data.toString().trim()}`);
  });

  process.on('close', (code) => {
    activeDownloads.delete(id);

    if (code === 0 && outputPath) {
      console.log(`[DOWNLOAD] Complete: ${basename(outputPath)}`);
      ws.send(JSON.stringify({
        id,
        ok: true,
        path: outputPath,
        filename: basename(outputPath)
      }));
    } else {
      console.error(`[DOWNLOAD] Failed with code ${code}`);
      ws.send(JSON.stringify({
        id,
        ok: false,
        error: { code: 'DOWNLOAD_FAILED', message: `yt-dlp exited with code ${code}` }
      }));
    }
  });

  process.on('error', (err) => {
    activeDownloads.delete(id);
    console.error(`[DOWNLOAD] Error: ${err.message}`);
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'DOWNLOAD_ERROR', message: err.message }
    }));
  });
}

/**
 * Handle file retrieval request
 */
function handleGetFile(ws, message) {
  const { id, path } = message;

  if (!path) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'INVALID_PATH', message: 'No path provided' }
    }));
    return;
  }

  // Security check - only allow files in download directory
  if (!path.startsWith(DOWNLOAD_DIR)) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'PERMISSION_DENIED', message: 'Access denied' }
    }));
    return;
  }

  if (!existsSync(path)) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'FILE_NOT_FOUND', message: 'File not found' }
    }));
    return;
  }

  try {
    const stats = statSync(path);
    const data = readFileSync(path);
    const base64 = data.toString('base64');

    ws.send(JSON.stringify({
      id,
      ok: true,
      data: base64,
      size: stats.size,
      filename: basename(path)
    }));
  } catch (err) {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'READ_ERROR', message: err.message }
    }));
  }
}

/**
 * Handle cancel download request
 */
function handleCancelDownload(ws, message) {
  const { id, download_id } = message;
  const targetId = download_id || id;

  const process = activeDownloads.get(targetId);
  if (process) {
    process.kill('SIGTERM');
    activeDownloads.delete(targetId);
    console.log(`[DOWNLOAD] Cancelled: ${targetId}`);
    ws.send(JSON.stringify({ id, ok: true, cancelled: true }));
  } else {
    ws.send(JSON.stringify({
      id,
      ok: false,
      error: { code: 'NOT_FOUND', message: 'No active download with that ID' }
    }));
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[!] Shutting down...');

  // Kill all active downloads
  for (const [id, proc] of activeDownloads) {
    console.log(`[!] Killing download: ${id}`);
    proc.kill('SIGTERM');
  }

  wss.close(() => {
    console.log('[!] Server closed');
    process.exit(0);
  });
});
