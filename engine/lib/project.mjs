import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PATHS = {
  root: ROOT,
  engine: path.join(ROOT, 'engine'),
  video: path.join(ROOT, 'video'),
  projects: path.join(ROOT, 'projects'),
  assets: path.join(ROOT, 'assets'),
  out: path.join(ROOT, 'out'),
  logs: path.join(ROOT, 'out', 'logs'),
  render: path.join(ROOT, 'out', 'render'),
  schema: path.join(ROOT, 'engine', 'schema', 'project.schema.json'),
};

export function ensureDirs() {
  for (const d of [PATHS.out, PATHS.logs, PATHS.render]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Resolve a project reference: absolute path, or a name under projects/. */
export function resolveProject(ref) {
  if (!ref) return null;
  const direct = path.resolve(ref);
  if (fs.existsSync(path.join(direct, 'project.json'))) return direct;
  const named = path.join(PATHS.projects, ref);
  if (fs.existsSync(path.join(named, 'project.json'))) return named;
  return null;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadProject(ref) {
  const dir = resolveProject(ref);
  if (!dir) {
    const err = new Error(`工程未找到: ${ref}\n已查找: ${path.resolve(ref)} 与 ${path.join(PATHS.projects, ref)}`);
    err.exitCode = 2;
    throw err;
  }
  const cfgPath = path.join(dir, 'project.json');
  const cfg = readJson(cfgPath);
  return { dir, cfgPath, cfg };
}

/** Minimal structural validation without external deps. */
export function validateProject(cfg) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };

  req(typeof cfg.id === 'string' && cfg.id.length > 0, 'id 缺失');
  req(typeof cfg.title === 'string' && cfg.title.length > 0, 'title 缺失');
  req(cfg.video && typeof cfg.video === 'object', 'video 缺失');

  if (cfg.video) {
    const v = cfg.video;
    for (const k of ['width', 'height', 'fps', 'durationInFrames']) {
      req(Number.isInteger(v[k]) && v[k] > 0, `video.${k} 必须为正整数`);
    }
    req(v.width === 1080 || v.width > 0, 'video.width 非法');
    req(v.height === 1920 || v.height > 0, 'video.height 非法');
  }

  req(Array.isArray(cfg.scenes) && cfg.scenes.length > 0, 'scenes 必须是非空数组');

  const seen = new Set();
  let cursor = 0;
  for (const [i, s] of (cfg.scenes || []).entries()) {
    const tag = `scenes[${i}]`;
    req(typeof s.id === 'string' && s.id.length > 0, `${tag}.id 缺失`);
    if (s.id) {
      req(!seen.has(s.id), `${tag}.id 重复: ${s.id}`);
      seen.add(s.id);
    }
    req(typeof s.type === 'string', `${tag}.type 缺失`);
    req(Number.isInteger(s.from) && s.from >= 0, `${tag}.from 必须为 >=0 整数`);
    req(Number.isInteger(s.durationInFrames) && s.durationInFrames > 0, `${tag}.durationInFrames 必须为正整数`);
    if (Number.isInteger(s.from) && Number.isInteger(s.durationInFrames)) {
      req(s.from >= cursor - 0, `${tag} 与上一镜头时间重叠 (from=${s.from} < ${cursor})`);
      cursor = s.from + s.durationInFrames;
    }
  }

  if (cfg.video && Number.isInteger(cfg.video.durationInFrames) && cursor > cfg.video.durationInFrames) {
    errors.push(`镜头总长度 ${cursor} 帧超出 video.durationInFrames=${cfg.video.durationInFrames}`);
  }

  return errors;
}

/** Resolve an asset path relative to the project dir (or absolute passthrough). */
export function assetPath(projectDir, rel) {
  if (!rel) return null;
  if (path.isAbsolute(rel)) return rel;
  return path.join(projectDir, rel);
}

export function findProjectLocal(file) {
  return fs.existsSync(file) ? file : null;
}