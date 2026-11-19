/** Portable editor handoff. No rendering, project writes, or editor import side effects. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, validateProject } from './project.mjs';
import { hashFile, validatedSceneClips } from './render-scenes.mjs';

const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
const sourceKeys = new Set(['src', 'image', 'video', 'fontPath']);
function sourceFile(projectDir, src) {
  if (typeof src !== 'string' || !src || /^(https?:|data:)/i.test(src)) throw new Error(`素材必须是本地文件: ${src}`);
  const file = src.startsWith('file:') ? fileURLToPath(src) : path.isAbsolute(src) ? src
    : fs.existsSync(path.resolve(projectDir, 'assets', src)) ? path.resolve(projectDir, 'assets', src) : path.resolve(projectDir, src);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`缺少素材: ${src}`);
  return fs.realpathSync(file);
}
function noSymlinkAncestors(file) {
  for (let p = file; ; p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error(`输出路径不允许符号链接: ${p}`);
    if (p === path.dirname(p)) break;
  }
}
function srtTime(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
/** Display pages/captions take precedence over raw ASR; only word fallback is regrouped. */
export function captionsToSrt(data, fps) {
  const display = [data.pages, data.captions].find((rows) => Array.isArray(rows) && rows.length);
  const words = Array.isArray(data.words) && data.words.length ? data.words : null;
  const rows = display ?? words ?? data.segments ?? (Array.isArray(data) ? data : []);
  const rate = data.fps ?? fps;
  if (!(Number.isFinite(rate) && rate > 0)) throw new Error('无效字幕 fps');
  const cues = [];
  for (const row of rows) {
    const text = String(row.text ?? row.word ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = row.fromSec ?? row.start ?? row.from / rate;
    const end = row.toSec ?? row.end ?? row.to / rate;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('无效字幕时间戳');
    const chars = Array.from(text), pieces = [];
    while (chars.length) {
      let n = Math.min(16, chars.length);
      if (chars.length > 16) {
        for (let i = 15; i >= 11; i--) if (/[\s，。！？、,.;!?]/u.test(chars[i])) { n = i + 1; break; }
      }
      pieces.push(chars.splice(0, n).join(''));
    }
    let offset = 0;
    for (const piece of pieces) {
      const count = Array.from(piece).length;
      const from = Math.round((start + (end - start) * offset / Array.from(text).length) * 1000);
      offset += count;
      const to = Math.round((start + (end - start) * offset / Array.from(text).length) * 1000);
      if (to <= from) throw new Error('字幕过短，无法以毫秒精度分割');
      if (piece.trim()) cues.push({ from, to, text: piece.trim() });
    }
  }
  cues.sort((a, b) => a.from - b.from);
  for (let i = 1; i < cues.length; i++) {
    if (cues[i - 1].to > cues[i].from) {
      cues[i - 1].to = cues[i].from;
      if (cues[i - 1].to <= cues[i - 1].from) throw new Error('字幕时间戳重叠');
    }
  }
  const pages = [];
  for (const cue of cues) {
    const last = pages.at(-1);
    const separator = last && /[a-z0-9]$/i.test(last.text) && /^[a-z0-9]/i.test(cue.text) ? ' ' : '';
    if (!display && last && cue.from - last.to <= 600 && Array.from(last.text + separator + cue.text).length <= 16
      && !(Array.from(last.text).length >= 12 && /[，。！？,.;!?]$/u.test(last.text))) {
      last.text += separator + cue.text;
      last.to = cue.to;
    } else pages.push({ ...cue });
  }
  return pages.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join('\n');
}

/**
 * @param {{projectDir:string,cfg:object,outDir:string,force?:boolean,sceneClipsDir?:string,sceneRenderOptions?:object}} options
 * @returns {Promise<object>} Throws on missing assets/unsafe output/invalid config.
 * sceneClipsDir is optional: only independently validated render-scenes manifest entries are used.
 */
export async function buildHandoff({ projectDir, cfg, outDir, force = false, sceneClipsDir = null, sceneRenderOptions = {} }) {
  if (!projectDir || !outDir) throw new Error('projectDir/outDir 必填');
  projectDir = fs.realpathSync(projectDir);
  const target = path.resolve(outDir), projects = fs.realpathSync(PATHS.projects);
  noSymlinkAncestors(target);
  if (inside(projectDir, target) || inside(target, projectDir) || inside(projects, target) || inside(target, projects)) throw new Error('outDir 不得与项目目录重叠');
  if (fs.existsSync(target) && !force) throw new Error(`输出已存在: ${target}`);
  const errors = validateProject(cfg);
  if (errors.length) throw new Error(errors.join('; '));
  const portable = structuredClone(cfg), assets = new Map(), references = new Map();
  const collect = (src, reference) => {
    const file = sourceFile(projectDir, src);
    if (inside(target, file)) throw new Error(`输出不得包含源素材: ${file}`);
    const sha256 = hashFile(file), ext = path.extname(file).toLowerCase();
    const rel = `assets/${sha256}${ext}`;
    if (!assets.has(rel)) assets.set(rel, { path: rel, sha256, bytes: fs.statSync(file).size, sources: [], references: [], licenses: [] });
    const entry = assets.get(rel);
    if (!entry.sources.includes(src)) entry.sources.push(src);
    if (reference && !entry.references.includes(reference)) entry.references.push(reference);
    references.set(file, rel);
    return rel;
  };
  // Include all project-owned assets, not just those currently on the timeline.
  const inventory = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw new Error(`素材目录不支持符号链接: ${file}`);
      if (e.isDirectory()) inventory(file);
      else collect(file, 'inventory');
    }
  };
  inventory(path.join(projectDir, 'assets'));
  const walk = (obj, pointer = '') => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      // Engine project references are relative to assets/, unlike editor timeline paths.
      if (sourceKeys.has(key) && typeof value === 'string' && value) obj[key] = collect(value, `${pointer}/${key}`).slice('assets/'.length);
      else if (value && typeof value === 'object') walk(value, `${pointer}/${key}`);
    }
  };
  walk(portable);
  for (let i = 0; i < (cfg.licenses ?? []).length; i++) {
    const license = cfg.licenses[i];
    const file = sourceFile(projectDir, license.asset), rel = collect(license.asset, `/licenses/${i}/asset`);
    assets.get(rel).licenses.push(structuredClone(license));
    portable.licenses[i].asset = references.get(file).slice('assets/'.length);
  }
  let srt = '';
  if (cfg.captions?.src) {
    const file = sourceFile(projectDir, cfg.captions.src);
    srt = captionsToSrt(JSON.parse(fs.readFileSync(file, 'utf8')), cfg.video.fps);
  }
  const clips = sceneClipsDir ? validatedSceneClips(projectDir, cfg, sceneClipsDir, sceneRenderOptions) : new Map();
  const warnings = [];
  const scenes = cfg.scenes.map((scene) => {
    const base = { sceneId: scene.id, from: scene.from, duration: scene.durationInFrames, durationInFrames: scene.durationInFrames, editor: true };
    const native = scene.props?.src ?? scene.props?.image ?? scene.props?.video;
    if (native && ['image-scene', 'video-scene'].includes(scene.type)) {
      return { ...base, kind: scene.type === 'image-scene' ? 'image' : 'video', src: collect(native, `scene:${scene.id}`), native: true };
    }
    if (clips.has(scene.id)) return { ...base, kind: 'clip', src: collect(clips.get(scene.id), `scene:${scene.id}`), native: false, muted: true, validated: true };
    warnings.push(`镜头 ${scene.id} 无有效 editor 渲染缓存，保留待渲染标记`);
    return { ...base, kind: 'unrendered', requiresRender: true };
  });
  // Only configured layers: never discover/add a mix, stem, or a second voice track.
  const timeline = { version: 1, timebase: 'frames', video: structuredClone(cfg.video), scenes,
    audio: structuredClone(portable.audio?.layers ?? []).map((layer) => ({ ...layer, src: `assets/${layer.src}` })),
    captions: { src: 'captions.srt', enabled: cfg.captions?.enabled ?? false, native: true } };
  for (const layer of timeline.audio) {
    if (!Number.isInteger(layer.from) || layer.from < 0 || (layer.volume !== undefined && (!Number.isFinite(layer.volume) || layer.volume < 0 || layer.volume > 4))) throw new Error(`无效音频轨: ${layer.id}`);
  }
  const manifest = { version: 1, projectId: cfg.id, assets: [...assets.values()], licenses: structuredClone(cfg.licenses ?? []),
    scenes: scenes.map((s) => ({ ...s })), warnings, editorImport: 'not-verified' };
  // All validation precedes writes. Reject links/extra existing files even when forcing.
  const checkOutputTree = (dir) => {
    if (!fs.existsSync(dir)) return;
    if (!fs.lstatSync(dir).isDirectory()) throw new Error(`输出不是目录: ${dir}`);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink() || (e.isFile() && fs.statSync(file).nlink > 1)) throw new Error(`输出含链接: ${file}`);
      if (e.isDirectory()) checkOutputTree(file);
    }
  };
  checkOutputTree(target);
  fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
  const copied = new Set();
  for (const [file, rel] of references) {
    if (copied.has(rel)) continue;
    copied.add(rel);
    const dest = path.join(target, rel);
    fs.copyFileSync(file, dest, force ? 0 : fs.constants.COPYFILE_EXCL);
    if (hashFile(dest) !== assets.get(rel).sha256) throw new Error(`复制校验失败: ${rel}`);
  }
  for (const [name, data] of [['project.json', portable], ['timeline.json', timeline], ['manifest.json', manifest]]) {
    fs.writeFileSync(path.join(target, name), JSON.stringify(data, null, 2) + '\n', { flag: force ? 'w' : 'wx' });
  }
  fs.writeFileSync(path.join(target, 'captions.srt'), srt, { flag: force ? 'w' : 'wx' });
  return { ok: true, outDir: target, manifest, timeline, warnings };
}
