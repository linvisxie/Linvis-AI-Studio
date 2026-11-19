/**
 * Read-only FCPXML 1.10 serializer. No GUI, writes, timeline mutation or editor API.
 * Requires local ffprobe (LINVIS_FFPROBE overrides it) to reject missing/short media.
 *
 * src URLs are absolute, percent-encoded file URLs resolved against baseDir. Relative
 * file URLs have inconsistent editor support: after moving a portable folder, call
 * this function again with its NEW baseDir and overwrite timeline.fcpxml in the caller,
 * or relink assets in the editor. Original relative src values remain in metadata.
 * No promise is made that an old absolute URL follows a moved folder automatically.
 *
 * Picture clips are flattened, silent media, NOT native animations. Captions remain
 * a separate SRT; neither titles nor OpenChatCut import_timeline captions are emitted.
 * Constant gain is represented with adjust-volume. Fades are metadata-only: importing
 * them is NOT guaranteed; recreate them in the editor (or use a rendered audio stem).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const gcd = (a, b) => b ? gcd(b, a % b) : a;
function fraction(n, d = 1n) {
  if (d <= 0n || n < 0n) throw new Error('Invalid nonnegative time fraction');
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function rational(value) {
  const s = String(value);
  if (/^\d+\/\d+$/.test(s)) {
    const [n, d] = s.split('/').map(BigInt);
    return fraction(n, d);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid rational: ${s}`);
  const [whole, dec = ''] = s.split('.');
  return fraction(BigInt(whole + dec), 10n ** BigInt(dec.length));
}
const time = ({ n, d }) => `${n}/${d}s`;
const md = (key, value) => `<md key="com.linvis.${xml(key)}" value="${xml(value)}"/>`;
const metadata = (entries) => `<metadata>${entries.map(([k, v]) => md(k, v)).join('')}</metadata>`;
function frameCount(value, label, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

export function timelineToFcpxml(timeline, { name = 'Linvis Timeline', baseDir = process.cwd() } = {}) {
  const video = timeline?.video;
  if (!video || (timeline.timebase && timeline.timebase !== 'frames')) throw new Error('Expected frame-based timeline');
  const fps = rational(video.fps);
  if (!fps.n) throw new Error('Invalid fps');
  const total = frameCount(video.durationInFrames, 'durationInFrames', true);
  frameCount(video.width, 'width', true);
  frameCount(video.height, 'height', true);
  const frames = (n) => time(fraction(BigInt(n) * fps.d, fps.n));
  const media = new Map();
  const resource = (src, kind) => {
    if (typeof src !== 'string' || !src || /^(https?:|data:)/i.test(src)) throw new Error(`Missing local media: ${src}`);
    const file = src.startsWith('file:') ? fileURLToPath(src) : path.resolve(baseDir, src);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Missing media: ${src}`);
    const key = `${kind}:${file}`;
    if (media.has(key)) return media.get(key);
    const result = spawnSync(process.env.LINVIS_FFPROBE || 'ffprobe', [
      '-v', 'error', '-show_streams', '-of', 'json', file,
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Cannot probe media ${src}: ${result.error?.message ?? result.stderr}`);
    let streams;
    try { streams = JSON.parse(result.stdout).streams; } catch { throw new Error(`Invalid ffprobe response: ${src}`); }
    const stream = streams?.find((s) => s.codec_type === kind);
    if (!stream) throw new Error(`Missing ${kind} stream: ${src}`);
    let duration;
    if (/^\d+$/.test(String(stream.duration_ts)) && stream.time_base) {
      const tb = rational(stream.time_base);
      duration = fraction(BigInt(stream.duration_ts) * tb.n, tb.d);
    } else if (stream.duration && stream.duration !== 'N/A') duration = rational(stream.duration);
    else throw new Error(`Unknown source duration: ${src}`);
    // Round DOWN to project frames: never ask an editor to read past the source.
    const available = Number(duration.n * fps.n / (duration.d * fps.d));
    if (!Number.isSafeInteger(available) || available < 1) throw new Error(`Empty/too short media: ${src}`);
    const entry = { id: `r${media.size + 2}`, src, file, kind, duration, available, stream };
    media.set(key, entry);
    return entry;
  };

  if (!Array.isArray(timeline.scenes)) throw new Error('Missing scenes');
  const spine = [];
  let cursor = 0;
  for (const scene of [...timeline.scenes].sort((a, b) => a.from - b.from)) {
    const from = frameCount(scene.from, 'scene.from');
    const duration = frameCount(scene.durationInFrames ?? scene.duration, 'scene.duration', true);
    if (scene.requiresRender || !['clip', 'video'].includes(scene.kind)) throw new Error(`Scene requires rendered video clip: ${scene.sceneId}`);
    if (from < cursor || from + duration > total) throw new Error(`Scene overlap/out of bounds: ${scene.sceneId}`);
    if (from > cursor) spine.push({ from: cursor, duration: from - cursor, children: [] });
    const asset = resource(scene.src, 'video');
    if (duration > asset.available) throw new Error(`Source shorter than scene: ${scene.sceneId}`);
    spine.push({ from, duration, asset, name: scene.sceneId ?? 'Picture', children: [] });
    cursor = from + duration;
  }
  if (cursor < total) spine.push({ from: cursor, duration: total - cursor, children: [] });

  for (const [i, layer] of (timeline.audio ?? []).entries()) {
    const from = frameCount(layer.from ?? 0, 'audio.from');
    if (from >= total) throw new Error(`Audio outside timeline: ${layer.id}`);
    const asset = resource(layer.src, 'audio');
    const requested = layer.durationInFrames ?? layer.duration ?? (total - from);
    frameCount(requested, 'audio.duration', true);
    const duration = Math.min(requested, total - from, asset.available);
    const gain = layer.volume ?? 1;
    if (!Number.isFinite(gain) || gain < 0) throw new Error(`Invalid audio gain: ${layer.id}`);
    const fadeIn = frameCount(layer.fadeInFrames ?? 0, 'fadeInFrames');
    const fadeOut = frameCount(layer.fadeOutFrames ?? 0, 'fadeOutFrames');
    const parent = spine.find((s) => s.from <= from && from < s.from + s.duration);
    // Parent source start is always zero, so connected offsets are parent-local.
    const db = gain === 0 ? '-96' : String(Number((20 * Math.log10(gain)).toFixed(6)));
    parent.children.push(`<asset-clip ref="${asset.id}" name="${xml(layer.id ?? `Audio ${i + 1}`)}" lane="-${i + 1}" offset="${frames(from - parent.from)}" start="0/1s" duration="${frames(duration)}" audioRole="${layer.role === 'voice' ? 'dialogue' : layer.role === 'music' ? 'music' : 'effects'}"${gain === 0 ? ' enabled="0"' : ''}>` +
      `<adjust-volume amount="${db}dB"/>` + metadata([
        ['source-relative', layer.src], ['gain-linear', gain], ['fadeInFrames', fadeIn], ['fadeOutFrames', fadeOut],
        ['fade-import', 'NOT GUARANTEED: metadata only; recreate fades in editor or use rendered audio'],
      ]) + '</asset-clip>');
  }

  const assets = [...media.values()].map((a) => {
    const attrs = a.kind === 'video'
      ? 'hasVideo="1" hasAudio="0" format="r1"'
      : `hasVideo="0" hasAudio="1" audioSources="1" audioChannels="${Number(a.stream.channels) || 2}" audioRate="${Number(a.stream.sample_rate) || 48000}"`;
    return `<asset id="${a.id}" name="${xml(path.basename(a.file))}" start="0/1s" duration="${time(a.duration)}" ${attrs}>` +
      `<media-rep kind="original-media" src="${xml(pathToFileURL(a.file).href)}"/>` +
      metadata([['source-relative', a.src]]) + '</asset>';
  }).join('\n');
  const clips = spine.map((s) => s.asset
    ? `<asset-clip ref="${s.asset.id}" name="${xml(s.name)}" offset="${frames(s.from)}" start="0/1s" duration="${frames(s.duration)}">${s.children.join('')}</asset-clip>`
    : `<gap name="Gap" offset="${frames(s.from)}" start="0/1s" duration="${frames(s.duration)}">${s.children.join('')}</gap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n<resources>\n` +
    `<format id="r1" name="LinvisVideo" frameDuration="${frames(1)}" width="${video.width}" height="${video.height}" colorSpace="1-1-1 (Rec. 709)"/>\n${assets}\n</resources>\n` +
    `<library><event name="${xml(name)}"><project name="${xml(name)}"><sequence format="r1" duration="${frames(total)}" tcStart="0/1s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n<spine>\n${clips}\n</spine>\n` + metadata([
      ['picture-import', 'Flattened silent clips, not native animation; editor import unverified'],
      ['captions', `SRT sidecar only: ${timeline.captions?.src ?? 'captions.srt'}; no titles/captions imported by OpenChatCut import_timeline`],
      ['relocation', 'Absolute file URLs: regenerate timeline.fcpxml with new baseDir after moving portable folder, or relink media; relative URLs not guaranteed'],
    ]) + '\n</sequence></project></event></library>\n</fcpxml>\n';
}
