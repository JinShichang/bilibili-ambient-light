/*
 * Prepares the soundtrack: cuts the source track from START seconds, writes public/music.wav,
 * and estimates tempo + beat positions so scene cuts can land on the beat (src/beats.json).
 *
 * Usage (from promo/): node scripts/music.mjs [--source <file>] [--start 33] [--length 90]
 * Without --source, the first .flac/.mp3/.wav in the project root is used.
 */
import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PROMO, '..');
const FFMPEG = join(PROMO, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');

function args() {
  const out = { source: null, start: 33, length: 90 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') out.source = resolve(argv[++i]);
    else if (argv[i] === '--start') out.start = Number(argv[++i]);
    else if (argv[i] === '--length') out.length = Number(argv[++i]);
  }
  return out;
}

/** Runs the bundled ffmpeg without a shell (argument array, no quoting issues with the file name). */
function ffmpeg(ffArgs, { collect = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(FFMPEG, ffArgs, { stdio: ['ignore', collect ? 'pipe' : 'ignore', 'pipe'] });
    const chunks = [];
    let stderr = '';
    if (collect) child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolveRun(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-1500)}`))
    );
  });
}

/** Onset strength envelope: positive changes of short-time energy in a high-passed signal. */
function onsetEnvelope(samples, rate, hop) {
  const frames = Math.floor(samples.length / hop);
  const energy = new Float64Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const hp = samples[i] - prev; // first-order high-pass emphasizes drums/transients
      prev = samples[i];
      sum += hp * hp;
    }
    energy[f] = Math.log1p(sum / hop);
  }
  const onset = new Float64Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  // Remove slow trend so loud sections don't dominate.
  const win = Math.round(rate / hop); // ~1 s
  const out = new Float64Array(frames);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += onset[f];
    if (f >= win) acc -= onset[f - win];
    out[f] = Math.max(0, onset[f] - acc / Math.min(f + 1, win));
  }
  return out;
}

function estimateBeats(env, frameRate) {
  // Tempo: autocorrelation peak between 70 and 180 BPM.
  let best = { bpm: 120, score: -Infinity };
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * frameRate;
    let score = 0;
    for (let f = 0; f + lag * 4 < env.length; f++) {
      const l = Math.round(lag);
      score += env[f] * (env[f + l] + 0.5 * env[f + 2 * l] + 0.25 * env[f + 4 * l]);
    }
    score /= env.length;
    if (score > best.score) best = { bpm, score };
  }
  const period = (60 / best.bpm) * frameRate;
  // Phase: offset whose beat grid collects the most onset energy.
  let bestPhase = { phase: 0, score: -Infinity };
  for (let p = 0; p < period; p += 0.25) {
    let score = 0;
    for (let t = p; t < env.length; t += period) score += env[Math.round(t)] ?? 0;
    if (score > bestPhase.score) bestPhase = { phase: p, score };
  }
  // Autocorrelation often locks onto half the real tempo. If the half-beat positions carry about
  // as much onset energy as the beats themselves, the song is really twice as fast.
  const gridEnergy = (offset, step) => {
    let sum = 0;
    let count = 0;
    for (let t = bestPhase.phase + offset; t < env.length; t += step) {
      sum += env[Math.round(t)] ?? 0;
      count++;
    }
    return sum / count;
  };
  let bpm = best.bpm;
  let step = period;
  if (bpm < 100 && gridEnergy(period / 2, period) > 0.8 * gridEnergy(0, period)) {
    bpm *= 2;
    step = period / 2;
  }
  const beats = [];
  for (let t = bestPhase.phase; t < env.length; t += step) beats.push(t / frameRate);
  return { bpm, firstBeat: bestPhase.phase / frameRate, beats };
}

const opts = args();
let source = opts.source;
if (!source) {
  const files = (await readdir(ROOT)).filter((f) => ['.flac', '.mp3', '.wav', '.m4a'].includes(extname(f).toLowerCase()));
  if (!files.length) throw new Error(`no audio file found in ${ROOT}`);
  source = join(ROOT, files[0]);
}

// 1. Soundtrack for Remotion, already starting at the requested offset.
const wav = join(PROMO, 'public', 'music.wav');
await ffmpeg([
  '-y', '-hide_banner', '-loglevel', 'error',
  '-ss', String(opts.start), '-t', String(opts.length), '-i', source,
  '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav,
]);

// 2. Beat analysis on a mono 11 kHz copy.
const RATE = 11025;
const HOP = 128; // ~86 envelope frames per second
// The bundled ffmpeg has no raw PCM muxer, so pipe a WAV and skip to its "data" chunk.
const wavBuf = await ffmpeg(
  ['-hide_banner', '-loglevel', 'error', '-ss', String(opts.start), '-t', String(opts.length), '-i', source,
    '-vn', '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', '-f', 'wav', '-'],
  { collect: true }
);
const dataAt = wavBuf.indexOf('data', 12, 'ascii');
if (dataAt < 0) throw new Error('unexpected WAV output');
const pcm = wavBuf.subarray(dataAt + 8);
const samples = new Float64Array(Math.floor(pcm.length / 2));
for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
const env = onsetEnvelope(samples, RATE, HOP);
const { bpm, firstBeat, beats } = estimateBeats(env, RATE / HOP);

const result = {
  source: source.slice(ROOT.length + 1),
  start: opts.start,
  bpm,
  firstBeat: Number(firstBeat.toFixed(3)),
  beats: beats.map((b) => Number(b.toFixed(3))),
};
await writeFile(join(PROMO, 'src', 'beats.json'), JSON.stringify(result, null, 1));
console.log(`music.wav: ${opts.length}s from ${opts.start}s of ${result.source}`);
console.log(`tempo ~${bpm} BPM, first beat at ${result.firstBeat}s, ${beats.length} beats`);
