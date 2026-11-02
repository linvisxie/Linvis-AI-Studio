import path from 'node:path';
import fs from 'node:fs';
import { run, logLine } from './log.mjs';

export const FFMPEG = process.env.LINVIS_FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.LINVIS_FFPROBE || 'ffprobe';

const COMMON_ENC = [
  '-hide_banner',
  '-nostdin',
  '-y',
];

export async function ffmpegVersion() {
  const r = await run(FFMPEG, ['-hide_banner', '-version'], { echo: false });
  if (r.code !== 0) return null;
  const first = r.stdout.split('\n')[0] || '';
  const m = first.match(/ffmpeg version (\S+)/);
  return { raw: first.trim(), version: m ? m[1] : 'unknown' };
}

export async function hasFilter(name) {
  const r = await run(FFMPEG, ['-hide_banner', '-filters'], { echo: false });
  if (r.code !== 0) return false;
  return new RegExp(`\\s${name}\\s`).test(r.stdout);
}

export async function hasEncoder(name) {
  const r = await run(FFMPEG, ['-hide_banner', '-encoders'], { echo: false });
  if (r.code !== 0) return false;
  return new RegExp(`\\s${name}\\s`).test(r.stdout);
}

/** ffprobe a media file into a normalized object. */
export async function probe(file) {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ];
  const r = await run(FFPROBE, args, { echo: false });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim(), file };
  let data;
  try { data = JSON.parse(r.stdout); } catch (e) { return { ok: false, error: 'ffprobe JSON 解析失败', file }; }

  const v = (data.streams || []).find((s) => s.codec_type === 'video');
  const a = (data.streams || []).find((s) => s.codec_type === 'audio');
  const duration = Number(data.format?.duration ?? v?.duration ?? 0);

  return {
    ok: true,
    file,
    container: data.format?.format_name,
    durationSec: Number.isFinite(duration) ? duration : 0,
    sizeBytes: Number(data.format?.size ?? fs.statSync(file).size),
    bitrate: Number(data.format?.bit_rate ?? 0),
    video: v ? {
      codec: v.codec_name,
      width: v.width,
      height: v.height,
      fps: parseFps(v.r_frame_rate || v.avg_frame_rate),
      frames: Number(v.nb_frames ?? 0) || null,
      pixFmt: v.pix_fmt,
      profile: v.profile,
    } : null,
    audio: a ? {
      codec: a.codec_name,
      sampleRate: Number(a.sample_rate),
      channels: Number(a.channels),
      bitrate: Number(a.bit_rate ?? 0),
    } : null,
    raw: data,
  };
}

function parseFps(str) {
  if (!str || typeof str !== 'string') return null;
  const [n, d] = str.split('/').map(Number);
  if (!d) return n || null;
  return Math.round((n / d) * 1000) / 1000;
}

/**
 * Measure average luminance of a frame range using signalstats.
 * Returns { yavg, ylow, yhigh, satavg } in 0..255 / 0..1 space.
 */
export async function measureLuma(file, opts = {}) {
  const { startSec = 0, durationSec = null } = opts;
  const args = [...COMMON_ENC, '-i', file];
  if (durationSec) args.push('-ss', String(startSec), '-t', String(durationSec));
  args.push(
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-f', 'null', '-',
  );
  const r = await run(FFMPEG, args, { echo: false });
  const vals = [...r.stdout.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].map((m) => Number(m[1]));
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    samples: vals.length,
    yavg: Math.round(avg * 100) / 100,
    ymin: Math.round(Math.min(...vals) * 100) / 100,
    ymax: Math.round(Math.max(...vals) * 100) / 100,
    yavgNormalized: Math.round((avg / 255) * 1000) / 1000,
  };
}

/** Detect audio silence segments; useful to verify the "music hard stop" beat. */
export async function detectSilence(file, opts = {}) {
  const { noiseDb = -45, minDur = 0.25 } = opts;
  const args = [
    ...COMMON_ENC, '-i', file,
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`,
    '-f', 'null', '-',
  ];
  const r = await run(FFMPEG, args, { echo: false });
  const text = r.stderr + r.stdout;
  const starts = [...text.matchAll(/silence_start: (-?[0-9.]+)/g)].map((m) => Number(m[1]));
  const ends = [...text.matchAll(/silence_end: (-?[0-9.]+)/g)].map((m) => Number(m[1]));
  return { noiseDb, minDur, silenceStarts: starts, silenceEnds: ends, count: starts.length };
}

/** Loudness stats (EBU R128) via loudnorm print. */
export async function measureLoudness(file) {
  const args = [
    ...COMMON_ENC, '-i', file,
    '-af', 'loudnorm=print_format=json',
    '-f', 'null', '-',
  ];
  const r = await run(FFMPEG, args, { echo: false });
  const text = r.stderr + r.stdout;
  const m = text.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      inputI: Number(j.input_i),
      inputLra: Number(j.input_lra),
      inputTp: Number(j.input_tp),
      inputThresh: Number(j.input_thresh),
    };
  } catch { return null; }
}

/** Extract a single frame to PNG (for visual QA). */
export async function extractFrame(file, atSec, outPng) {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const r = await run(FFMPEG, [
    ...COMMON_ENC, '-ss', String(atSec), '-i', file,
    '-frames:v', '1', '-q:v', '2', outPng,
  ], { echo: false });
  return r.code === 0 && fs.existsSync(outPng);
}

/** Build a contact sheet of N frames evenly spread across the video. */
export async function contactSheet(file, outPng, { cols = 4, count = 8, tileW = 270 } = {}) {
  const p = await probe(file);
  if (!p.ok || !p.video) return null;
  const dur = p.durationSec || 1;
  const fps = p.video.fps || 30;
  const every = Math.max(1, Math.round((dur / count) * fps));
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const rows = Math.ceil(count / cols);
  const r = await run(FFMPEG, [
    ...COMMON_ENC, '-i', file,
    '-vf', `fps=1/${Math.max(0.1, dur / count)},scale=${tileW}:-1,tile=${cols}x${rows}`,
    '-frames:v', '1', outPng,
  ], { echo: false });
  logLine(`contactSheet every=${every} -> ${outPng} code=${r.code}`);
  return r.code === 0 ? outPng : null;
}

/** Concatenate/video+audio mux helper. */
export async function mux(inputVideo, inputAudio, outFile) {
  return run(FFMPEG, [
    ...COMMON_ENC, '-i', inputVideo, '-i', inputAudio,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', outFile,
  ], { echo: false });
}