/** Independent, silent editor clips. Remotion frameRange uses inclusive endpoints. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PATHS } from './project.mjs';
import { step, warn } from './log.mjs';

export const SCENE_MANIFEST = 'manifest.json';
export const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;

export function safeDirectoryName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 120
    && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name)
    && name !== '.' && name !== '..' && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

export function sceneClipName(id) {
  // Hash suffix also avoids case-insensitive filesystem collisions.
  return `scene-${String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)}-${hash(id).slice(0, 16)}.mp4`;
}

function resolveSource(projectDir, src) {
  if (/^(https?:|data:)/i.test(src)) throw new Error('逐镜头素材必须是本地文件，不能验证远程缓存');
  if (src.startsWith('file:')) return fileURLToPath(src);
  if (path.isAbsolute(src)) return path.resolve(src);
  const asset = path.resolve(projectDir, 'assets', src);
  return fs.existsSync(asset) ? asset : path.resolve(projectDir, src);
}

function treeHashes(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    if (e.name === '_project') return [];
    const file = path.join(dir, e.name), rel = `${prefix}${e.name}`;
    if (e.isSymbolicLink()) throw new Error(`不支持源目录符号链接: ${file}`);
    return e.isDirectory() ? treeHashes(file, `${rel}/`) : [[rel, hashFile(file)]];
  });
}

/** Conservative identity: full config, assets, explicit sources, video code/fonts and dependency lock. */
export function sceneRenderIdentity(projectDir, cfg, { scale = 1, crf = 18 } = {}) {
  if (!safeDirectoryName(cfg.id)) throw new Error('不安全的 project id');
  const ids = (cfg.scenes ?? []).map((s) => s.id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('scene id 必须非空且唯一');
  if (!(Number.isFinite(scale) && scale > 0) || !Number.isInteger(crf) || crf < 0 || crf > 51) throw new Error('无效的 scale/crf');
  const sources = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (['src', 'image', 'fontPath'].includes(key) && typeof value === 'string' && value) {
        const file = resolveSource(projectDir, value);
        sources.push([file, hashFile(file)]);
      } else if (typeof value === 'object') walk(value);
    }
  };
  walk(cfg);
  const parameters = { composition: 'LinvisVideo', renderMode: 'editor', muted: true,
    codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', videoImageFormat: 'png', scale, crf };
  const identity = { version: 1, configHash: hash(canonical(cfg)),
    sourceHash: hash([treeHashes(path.resolve(projectDir, 'assets')), sources.sort()]),
    rendererHash: hash([treeHashes(PATHS.video), hashFile(fileURLToPath(import.meta.url)),
      hashFile(fileURLToPath(new URL('./remotion.mjs', import.meta.url))),
      ...['package-lock.json', 'package.json'].filter((f) => fs.existsSync(path.join(PATHS.root, f))).map((f) => [f, hashFile(path.join(PATHS.root, f))])]),
    parameters };
  return { ...identity, fingerprint: hash(canonical(identity)) };
}

export function validatedSceneClips(projectDir, cfg, dir, parameters = {}) {
  const identity = sceneRenderIdentity(projectDir, cfg, parameters);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, SCENE_MANIFEST), 'utf8')); } catch { return new Map(); }
  if (manifest.fingerprint !== identity.fingerprint) return new Map();
  const clips = new Map();
  for (const s of cfg.scenes ?? []) {
    const entry = manifest.clips?.[s.id];
    const file = path.resolve(dir, sceneClipName(s.id));
    if (entry?.file !== sceneClipName(s.id) || entry.from !== s.from || entry.durationInFrames !== s.durationInFrames) continue;
    try {
      if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).size || hashFile(file) !== entry.sha256) continue;
      clips.set(s.id, file);
    } catch { /* incomplete or removed output is not a cache hit */ }
  }
  return clips;
}

/** Runtime injection is for local tests; production uses the real Remotion modules. */
export async function renderScenes({ projectDir, cfg, outDir = null, only = null, scale = 1, crf = 18,
  force = false, onProgress = null, runtime = null }) {
  const scenes = cfg.scenes ?? [];
  if (!scenes.length) return { ok: false, error: '工程没有 scenes', clips: [], skipped: [] };
  projectDir = path.resolve(projectDir);
  const identity = sceneRenderIdentity(projectDir, cfg, { scale, crf });
  const target = path.resolve(outDir ?? path.join(PATHS.render, 'scenes', cfg.id));
  const selected = only?.length ? scenes.filter((s) => only.includes(s.id)) : scenes;
  const missing = only?.filter((id) => !scenes.some((s) => s.id === id)) ?? [];
  if (missing.length || !selected.length) return { ok: false, error: `未找到指定镜头: ${missing.join(', ')}`, clips: [], skipped: [] };
  for (const s of selected) {
    if (!Number.isInteger(s.from) || !Number.isInteger(s.durationInFrames) || s.from < 0 || s.durationInFrames < 1
      || s.from + s.durationInFrames > cfg.video.durationInFrames) {
      return { ok: false, error: `镜头帧区间越界: ${s.id}`, clips: [], skipped: [] };
    }
  }
  fs.mkdirSync(target, { recursive: true });
  const cached = force ? new Map() : validatedSceneClips(projectDir, cfg, target, { scale, crf });
  const manifest = { ...identity, clips: Object.create(null) };
  for (const s of scenes) {
    if (cached.has(s.id)) manifest.clips[s.id] = { file: sceneClipName(s.id), from: s.from,
      durationInFrames: s.durationInFrames, sha256: hashFile(cached.get(s.id)) };
  }
  const saveManifest = () => {
    const tmp = path.join(target, `.${crypto.randomUUID()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, path.join(target, SCENE_MANIFEST));
  };
  // Invalidate old entries before rendering, including when a render fails halfway.
  saveManifest();
  let renderer, serveUrl, inputProps, composition, browserExecutable;
  const chromiumOptions = { gl: 'angle', disableWebSecurity: false };
  if (selected.some((s) => !cached.has(s.id))) {
    renderer = runtime?.renderer ?? await import('@remotion/renderer');
    const bundler = runtime?.bundler ?? await import('@remotion/bundler');
    const bridge = runtime?.bridge ?? await import('./remotion.mjs');
    // Content-addressed public names avoid basename collisions and stale mtime copies
    // in the legacy input-props bridge. Audio is imported as separate native tracks.
    const editorCfg = structuredClone(cfg);
    editorCfg.audio = { layers: [] };
    for (const s of editorCfg.scenes) {
      for (const key of ['src', 'image']) {
        const src = s.props?.[key];
        if (!src) continue;
        const source = resolveSource(projectDir, src);
        const dest = path.join(PATHS.video, 'public', '_project', cfg.id, `${hashFile(source)}${path.extname(source)}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(source, dest);
        s.props[key] = dest;
      }
      if (s.props?.image && !s.props.src) s.props.src = s.props.image;
    }
    inputProps = { ...bridge.buildInputProps(projectDir, editorCfg), renderMode: 'editor' };
    step('打包 Remotion 工程（逐镜头 editor 模式）');
    serveUrl = await bundler.bundle({ entryPoint: path.join(PATHS.video, 'index.ts'),
      publicDir: path.join(PATHS.video, 'public'), outDir: path.join(PATHS.out, '.bundle'), rootDir: PATHS.root });
    browserExecutable = bridge.findBrowser();
    composition = await renderer.selectComposition({ serveUrl, id: 'LinvisVideo', inputProps, browserExecutable, chromiumOptions });
  }
  const clips = [], skipped = [];
  const totalFrames = selected.reduce((sum, s) => sum + s.durationInFrames, 0);
  let doneFrames = 0;
  for (const [i, s] of selected.entries()) {
    const file = path.join(target, sceneClipName(s.id));
    const clip = { id: s.id, type: s.type, file, from: s.from, durationInFrames: s.durationInFrames };
    if (cached.has(s.id)) { clips.push({ ...clip, reused: true }); doneFrames += s.durationInFrames; continue; }
    const tmp = path.join(target, `.${crypto.randomUUID()}.mp4`);
    try {
      const end = s.from + s.durationInFrames - 1;
      if (end >= composition.durationInFrames) throw new Error('镜头超过 composition 长度，拒绝截短');
      await renderer.renderMedia({ serveUrl, composition, outputLocation: tmp, inputProps,
        codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', videoImageFormat: 'png',
        scale, crf, muted: true, concurrency: 2, overwrite: true, browserExecutable, chromiumOptions,
        frameRange: [s.from, end], logLevel: 'error',
        onProgress: ({ progress }) => onProgress?.({ scene: s.id, index: i + 1, total: selected.length,
          progress, doneFrames: doneFrames + Math.floor(progress * s.durationInFrames), totalFrames }) });
      if (!fs.statSync(tmp).size) throw new Error('渲染输出为空');
      fs.renameSync(tmp, file);
      manifest.clips[s.id] = { file: sceneClipName(s.id), from: s.from, durationInFrames: s.durationInFrames, sha256: hashFile(file) };
      saveManifest();
      clips.push({ ...clip, bytes: fs.statSync(file).size });
      doneFrames += s.durationInFrames;
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      skipped.push({ id: s.id, reason: e.message.slice(0, 300) });
      warn(`镜头 ${s.id} 渲染失败: ${e.message}`);
    }
  }
  return { ok: clips.length === selected.length && skipped.length === 0, outDir: target, clips, skipped,
    totalFrames: cfg.video.durationInFrames, ...(skipped.length ? { error: '部分指定镜头渲染失败' } : {}) };
}
