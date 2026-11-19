/**
 * Remotion rendering bridge — the only place that knows about Remotion.
 * The CLI stays platform-agnostic; anyone can call these functions.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { PATHS, ensureDirs } from './project.mjs';
import { step, info, warn, logLine } from './log.mjs';

const require = createRequire(import.meta.url);

/** Locate a system Chromium-family browser so we never download one. */
export function findBrowser() {
  if (process.env.LINVIS_BROWSER && fs.existsSync(process.env.LINVIS_BROWSER)) {
    return process.env.LINVIS_BROWSER;
  }
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Bundle the Remotion project and render the composition.
 * @param {object} args
 *   projectDir, cfg, outFile, scale (1 = full), frameRange, onProgress
 */
export async function renderComposition({
  projectDir,
  cfg,
  outFile,
  scale = 1,
  frameRange = null,
  crf = 18,
  concurrency = null,
  onProgress = null,
  stillFrame = null,
}) {
  ensureDirs();
  const bundler = await import('@remotion/bundler');
  const renderer = await import('@remotion/renderer');

  const entry = path.join(PATHS.video, 'index.ts');
  if (!fs.existsSync(entry)) throw new Error(`Remotion 入口缺失: ${entry}`);

  // 必须在 bundle 之前构建 inputProps：buildInputProps 会把工程私有素材
  // 复制进 video/public/_project；bundle 时才随 publicDir 一起打包。
  const inputProps = buildInputProps(projectDir, cfg);

  step('打包 Remotion 工程');
  const bundleDir = path.join(PATHS.out, '.bundle');
  const serveUrl = await bundler.bundle({
    entryPoint: entry,
    publicDir: path.join(PATHS.video, 'public'),
    outDir: bundleDir,
    rootDir: PATHS.root,
    onProgress: (p) => {
      if (p % 25 === 0) logLine(`bundle ${p}%`);
    },
  });
  info(`bundle ready: ${serveUrl}`);

  const browserExecutable = findBrowser();
  if (!browserExecutable) warn('未找到系统 Chrome/Edge，Remotion 将尝试使用内置浏览器');
  else info(`使用浏览器: ${browserExecutable}`);

  const chromiumOptions = { gl: 'angle', disableWebSecurity: false };

  step('解析 composition 元数据');
  const composition = await renderer.selectComposition({
    serveUrl,
    id: 'LinvisVideo',
    inputProps,
    browserExecutable,
    chromiumOptions,
  });
  info(`composition: ${composition.id} ${composition.width}x${composition.height} @${composition.fps}fps, ${composition.durationInFrames} frames`);

  if (stillFrame !== null) {
    step(`导出单帧 #${stillFrame}`);
    const outPng = outFile.endsWith('.png') ? outFile : outFile.replace(/\.(mp4|mov|webm)$/i, '.png');
    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    await renderer.renderStill({
      serveUrl,
      composition,
      output: outPng,
      frame: stillFrame,
      inputProps,
      browserExecutable,
      chromiumOptions,
      overwrite: true,
    });
    info(`单帧已导出: ${outPng}`);
    return { ok: true, outFile: outPng, composition, serveUrl };
  }

  step('渲染视频');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const started = Date.now();

  await renderer.renderMedia({
    serveUrl,
    composition,
    outputLocation: outFile,
    inputProps,
    codec: 'h264',
    crf,
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    videoImageFormat: 'png',
    jpegQuality: 92,
    scale,
    concurrency: concurrency ?? Math.max(1, Math.min(8, Math.floor(require('node:os').cpus().length / 2))),
    overwrite: true,
    browserExecutable,
    chromiumOptions,
    frameRange: frameRange ?? undefined,
    audioCodec: 'aac',
    audioBitrate: '256k',
    logLevel: 'info',
    onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) => {
      if (onProgress) onProgress({ progress, renderedFrames, encodedFrames, stitchStage });
    },
    onBrowserLog: (log) => {
      if (log.type === 'error') logLine(`BROWSER_ERROR ${log.text}`);
    },
  });

  const ms = Date.now() - started;
  const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
  info(`渲染完成: ${outFile} (${(size / 1024 / 1024).toFixed(2)} MB, ${(ms / 1000).toFixed(1)}s)`);
  return { ok: true, outFile, composition, serveUrl, ms, sizeBytes: size };
}

/**
 * Build Remotion inputProps from the project config.
 * Copies audio references into the bundle's public dir via absolute file:// URLs
 * so project-local assets resolve without polluting video/public.
 */
export function buildInputProps(projectDir, cfg) {
  const assetsDir = path.join(projectDir, 'assets');

  const toSrc = (src) => {
    if (!src) return src;
    if (/^(https?:|data:|file:)/.test(src)) return src;
    const abs = path.isAbsolute(src) ? src : path.join(assetsDir, src);
    if (fs.existsSync(abs)) {
      // 每个工程独立子目录，避免多工程同名素材互相覆盖
      const publicDir = path.join(PATHS.video, 'public', '_project', cfg.id);
      fs.mkdirSync(publicDir, { recursive: true });
      const digest = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
      const name = `${digest}-${path.basename(abs)}`;
      const dest = path.join(publicDir, name);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(abs, dest);
        logLine(`asset copy ${abs} -> ${dest}`);
      }
      return `_project/${cfg.id}/${name}`;
    }
    warn(`素材未找到: ${abs}`);
    return src;
  };

  const scenes = (cfg.scenes || []).map((s) => {
    const props = { ...(s.props || {}) };
    if (props.src) props.src = toSrc(props.src);
    if (props.image) props.image = toSrc(props.image);
    return { ...s, props };
  });

  const layers = (cfg.audio?.layers || []).map((l) => ({ ...l, src: toSrc(l.src) }));

  // 字幕：从 captions.src 读取转写结果（词级时间轴 + 段级）
  let captions = cfg.captions ?? { enabled: false };
  if (captions.enabled && captions.src) {
    const capFile = path.isAbsolute(captions.src) ? captions.src : path.join(projectDir, 'assets', captions.src);
    if (fs.existsSync(capFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(capFile, 'utf8'));
        captions = {
          ...captions,
          words: data.words ?? [],
          captions: data.captions ?? [],
          language: data.language,
          engine: data.engine,
        };
        logLine(`captions loaded: ${data.captions?.length ?? 0} segs, ${data.words?.length ?? 0} words`);
      } catch (e) {
        warn(`字幕文件解析失败: ${capFile} — ${e.message}`);
        captions = { ...captions, enabled: false };
      }
    } else {
      warn(`字幕文件不存在: ${capFile}`);
      captions = { ...captions, enabled: false };
    }
  }

  return {
    id: cfg.id,
    title: cfg.title,
    video: cfg.video,
    theme: cfg.theme ?? {},
    scenes,
    audio: { layers },
    captions,
    renderMode: cfg.renderMode ?? 'delivery',
  };
}
