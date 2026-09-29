/*
 * Encodes the recorded frame sequences (recordings/frames/<clip>-<variant>/00000.jpg ...)
 * into H.264 clips in public/clips/<clip>-<variant>.mp4, using the ffmpeg bundled with Remotion.
 *
 * Usage (from promo/): node scripts/encode.mjs [--keep-frames]
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES_DIR = join(PROMO, 'recordings', 'frames');
const CLIPS_DIR = join(PROMO, 'public', 'clips');
const FPS = 30;

function run(args) {
  return new Promise((resolveRun, reject) => {
    // A shell is needed on Windows to resolve npx.cmd. Arguments are fixed flags and quoted local
    // paths built by this script (no user input), joined into one command line.
    const command = ['npx', 'remotion', 'ffmpeg', ...args].join(' ');
    const child = spawn(command, { cwd: PROMO, shell: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolveRun() : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`))));
  });
}

const keepFrames = process.argv.includes('--keep-frames');
await mkdir(CLIPS_DIR, { recursive: true });
const dirs = (await readdir(FRAMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
if (!dirs.length) throw new Error(`no frame folders in ${FRAMES_DIR}`);

for (const dir of dirs) {
  const input = join(FRAMES_DIR, dir.name);
  const count = (await readdir(input)).filter((f) => f.endsWith('.jpg')).length;
  const output = join(CLIPS_DIR, `${dir.name}.mp4`);
  await run([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', `"${join(input, '%05d.jpg')}"`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    `"${output}"`,
  ]);
  console.log(`${dir.name}: ${count} frames -> ${output}`);
  if (!keepFrames) await rm(input, { recursive: true, force: true });
}
