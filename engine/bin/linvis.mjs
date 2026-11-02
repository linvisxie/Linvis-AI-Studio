#!/usr/bin/env node
/**
 * linvis — Linvis AI Studio 平台无关命令行入口
 *
 * 用法: node engine/bin/linvis.mjs <command> [args] [--flags]
 * 这个入口不 import 任何 Agent 平台 SDK。Cindy / Codex / DSH / 纯 cmd 都可调用。
 */
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';

import { PATHS, ensureDirs, loadProject, resolveProject, validateProject, readJson } from '../lib/project.mjs';
import { startLog, logPath, info, warn, step, fail, printFailureSummary, run } from '../lib/log.mjs';
import { probe, extractFrame, measureLuma, detectSilence, measureLoudness, ffmpegVersion, hasFilter, hasEncoder } from '../lib/ffmpeg.mjs';

const HELP = `Linvis AI Studio v1.0 — 本地 AI 视频引擎

用法:
  linvis <command> [project] [options]

命令:
  doctor                    检查运行环境
  init <ProjectName>        创建新视频工程（拒绝覆盖）
  audio <project>           按 recipe 生成背景音乐与音效
  captions <project>        用 whisper 转写配音生成字幕
  preview <project>         低成本预览（半分辨率 / 快编码）
  render <project>          渲染完整视频 1080x1920
  still <project>           导出单帧 PNG 用于调试
  inspect <project>         检查输出视频质量
  list                      列出所有工程

通用参数:
  --project <ref>           工程名或路径
  --out <file>              指定输出文件
  --json                    机器可读输出
  --force                   允许覆盖已有输出
  --scale <n>               渲染缩放（preview 默认 0.5）
  --crf <n>                 画质（越小越好，render 默认 18）
  --frame <n>               单帧导出的帧号
  --recipe <name>           audio 使用的配方名（默认 ep01-open）
  --audio <file>            captions 使用的音频文件
  --model <name>            whisper 模型（默认 small）

示例:
  node engine/bin/linvis.mjs doctor
  node engine/bin/linvis.mjs render EP01-LLM-Harness
  node engine/bin/linvis.mjs preview EP01-LLM-Harness --scale 0.5
`;

/* ---------------- 参数解析 ---------------- */
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const jsonOut = (obj) => console.log(JSON.stringify(obj, null, 2));

/* ---------------- doctor ---------------- */
async function cmdDoctor(args) {
  const report = { ok: true, checks: [], warnings: [], optional: [] };
  const add = (name, status, detail, required = true) => {
    report.checks.push({ name, status, detail, required });
    if (status === 'fail' && required) report.ok = false;
  };

  // Node
  const major = Number(process.version.replace('v', '').split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `Node ${process.version} (需要 >= 20)`);

  // 项目结构
  const needDirs = [
    ['engine', PATHS.engine],
    ['video', PATHS.video],
    ['projects', PATHS.projects],
    ['assets', PATHS.assets],
  ];
  for (const [n, p] of needDirs) add(`dir:${n}`, fs.existsSync(p) ? 'pass' : 'fail', p);

  // 依赖
  const deps = ['remotion', '@remotion/renderer', '@remotion/bundler', 'react'];
  for (const d of deps) {
    const ok = fs.existsSync(path.join(PATHS.root, 'node_modules', ...d.split('/')));
    add(`dep:${d}`, ok ? 'pass' : 'fail', ok ? '已安装' : '未安装，请运行 npm install');
  }

  // FFmpeg
  const ffv = await ffmpegVersion();
  add('ffmpeg', ffv ? 'pass' : 'fail', ffv ? ffv.raw : '未在 PATH 中找到 ffmpeg');
  if (ffv) {
    const enc = await hasEncoder('libx264');
    add('ffmpeg:libx264', enc ? 'pass' : 'fail', enc ? 'H.264 编码器可用' : '缺少 libx264');
    const af = await hasFilter('loudnorm');
    add('ffmpeg:loudnorm', af ? 'pass' : 'warn', af ? '响度分析可用' : '缺少 loudnorm，inspect 将跳过响度检查', false);
  }

  // 浏览器
  const { findBrowser } = await import('../lib/remotion.mjs');
  const b = findBrowser();
  add('browser', b ? 'pass' : 'warn', b || '未找到系统 Chrome/Edge（Remotion 会尝试内置浏览器）', false);

  // Whisper：探测所有 (解释器, 引擎) 组合
  const tr = await import('../lib/transcribe.mjs');
  const eng = await tr.detectEngine();
  if (!eng.available) {
    add('whisper', 'warn', '未找到 faster-whisper 或 openai-whisper，字幕功能不可用', false);
  } else {
    const usable = eng.all ?? [eng];
    const fw = usable.find((u) => u.engine === 'faster-whisper');
    const ow = usable.find((u) => u.engine === 'openai-whisper');
    if (fw) add('whisper:faster-whisper', 'pass', `v${fw.version} (${fw.source})`);
    if (ow) add('whisper:openai-whisper', 'pass', `已安装 (${ow.source})，可离线转写`, false);
    if (!fw) {
      add('whisper:faster-whisper', 'warn', '未安装；当前用 openai-whisper 替代（速度较慢，功能完整）', false);
    }
  }
  report.optional.push({
    name: 'faster-whisper',
    installed: (eng.all ?? []).some((u) => u.engine === 'faster-whisper'),
    hint: (eng.all ?? []).some((u) => u.engine === 'faster-whisper')
      ? null
      : '可选加速：.venv\\Scripts\\python.exe -m pip install faster-whisper（需联网下载模型）',
  });

  // 字体
  const fontFile = path.join(PATHS.video, 'public', 'fonts', 'NotoSansSC-VF.ttf');
  add('font:NotoSansSC', fs.existsSync(fontFile) ? 'pass' : 'fail', fs.existsSync(fontFile) ? '中文字体就绪' : `缺少 ${fontFile}`);

  // 工程清单
  const projects = listProjects();
  add('projects', 'pass', projects.length ? `${projects.length} 个工程: ${projects.map((p) => p.id).join(', ')}` : '暂无工程，用 init 创建', false);

  if (args.flags.json) { jsonOut(report); return report.ok ? 0 : 1; }

  console.log('Linvis AI Studio — 环境诊断\n');
  for (const c of report.checks) {
    const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️ ' : '❌';
    console.log(`${icon} ${c.name.padEnd(26)} ${c.detail}`);
  }
  for (const o of report.optional) {
    if (!o.installed && o.hint) console.log(`\n可选: ${o.name} 未安装 → ${o.hint}`);
  }
  console.log(`\n结论: ${report.ok ? '环境就绪，可以渲染 ✅' : '存在必需项缺失 ❌'}`);
  return report.ok ? 0 : 1;
}

/* ---------------- init ---------------- */
function listProjects() {
  if (!fs.existsSync(PATHS.projects)) return [];
  return fs.readdirSync(PATHS.projects, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PATHS.projects, d.name, 'project.json')))
    .map((d) => {
      try {
        const cfg = readJson(path.join(PATHS.projects, d.name, 'project.json'));
        return { id: cfg.id ?? d.name, dir: path.join(PATHS.projects, d.name), title: cfg.title, frames: cfg.video?.durationInFrames };
      } catch { return { id: d.name, dir: path.join(PATHS.projects, d.name), title: '(配置损坏)' }; }
    });
}

async function cmdInit(args) {
  const name = args._[1];
  if (!name) { fail('请提供工程名，例如: linvis init EP02-xxx'); return 2; }
  const dir = path.join(PATHS.projects, name);
  if (fs.existsSync(dir)) {
    fail(`工程已存在，拒绝覆盖: ${dir}`);
    console.log('如需修改请在现有工程上编辑 project.json。');
    return 2;
  }

  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const cfg = {
    $schema: '../../engine/schema/project.schema.json',
    id: name,
    title: name,
    description: '',
    video: { width: 1080, height: 1920, fps: 30, durationInFrames: 300, backgroundColor: '#050607' },
    theme: { accent: '#00e5ff', accentAlt: '#ff0044', ink: '#ffffff' },
    scenes: [
      { id: 's1-opening', type: 'impact-title', from: 0, durationInFrames: 150, props: { text: '标题文字', kicker: 'LINVIS', hitFrame: 30, fontSize: 180 } },
      { id: 's2-question', type: 'reveal-question', from: 150, durationInFrames: 150, props: { question: '那么，问题是什么？', sublines: ['副标题一行'] } },
    ],
    audio: { layers: [] },
    captions: { enabled: false },
    licenses: [],
  };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  info(`工程已创建: ${dir}`);
  info(`下一步: 编辑 ${path.join(dir, 'project.json')}，然后运行 linvis render ${name}`);
  return 0;
}

/* ---------------- audio ---------------- */
async function cmdAudio(args) {
  const ref = args.flags.project ?? args._[1];
  const { dir, cfg } = loadProject(ref);
  const recipeName = args.flags.recipe ?? 'ep01-open';
  const recipePath = path.join(PATHS.assets, 'recipes', `${recipeName}.json`);
  if (!fs.existsSync(recipePath)) { fail(`配方不存在: ${recipePath}`); return 2; }

  const recipe = readJson(recipePath);
  const outFile = path.resolve(args.flags.out ?? path.join(dir, 'assets', `${recipeName}.wav`));
  step(`生成音频: ${recipeName}`);
  const A = await import('../lib/audio.mjs');
  const r = A.renderRecipe(recipe, outFile);
  info(`已生成 ${outFile}`);
  info(`时长 ${r.durationSec.toFixed(2)}s / ${r.sampleRate}Hz / ${r.channels}ch / 峰值归一化 ${r.normGain.toFixed(3)}x`);

  const p = await probe(outFile);
  if (args.flags.json) { jsonOut({ outFile, ...r, probe: p }); return 0; }
  info(`校验: ${p.video ? 'video?' : '纯音频'} ${p.durationSec.toFixed(2)}s ${p.audio?.codec} ${p.audio?.sampleRate}Hz`);
  return 0;
}

/* ---------------- captions ---------------- */
async function cmdCaptions(args) {
  const ref = args.flags.project ?? args._[1];
  const { dir, cfg } = loadProject(ref);
  const audioRel = args.flags.audio;
  if (!audioRel) { fail('请用 --audio <file> 指定配音音频'); return 2; }
  const audioFile = path.isAbsolute(audioRel) ? audioRel : path.join(dir, 'assets', audioRel);
  if (!fs.existsSync(audioFile)) { fail(`音频不存在: ${audioFile}`); return 2; }

  const model = args.flags.model ?? null;
  const outJson = path.join(dir, 'assets', 'captions.json');

  step(`转写: ${path.basename(audioFile)}${model ? ` (model=${model})` : ' (自动选模型)'}`);
  const tr = await import('../lib/transcribe.mjs');
  const r = await tr.transcribeToCaptions({
    audioFile,
    model,
    language: args.flags.language ?? 'zh',
    fps: cfg.video.fps,
    initialPrompt: args.flags.prompt ?? null,
    engine: args.flags.engine ?? 'auto',
  });

  fs.writeFileSync(outJson, JSON.stringify(r, null, 2), 'utf8');
  info(`字幕已写入: ${outJson}`);
  info(`引擎 ${r.engine} / 段数 ${r.captions.length} / 词数 ${r.words.length} / 语言 ${r.language}`);

  // 自动回写 project.json 的 captions 字段（不覆盖已有词级时间轴，除非 --force）
  if (args.flags.force || !cfg.captions?.enabled) {
    cfg.captions = { ...(cfg.captions ?? {}), enabled: true, src: 'captions.json' };
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    info('project.json 的 captions 已启用（src: captions.json）');
  }

  if (args.flags.json) { jsonOut({ outJson, ...r }); return 0; }
  return 0;
}

/* ---------------- preview / render ---------------- */
async function doRender(args, mode) {
  const ref = args.flags.project ?? args._[1];
  const { dir, cfg } = loadProject(ref);

  const errors = validateProject(cfg);
  if (errors.length) {
    fail('工程配置校验失败:');
    errors.forEach((e) => console.error('  - ' + e));
    return 2;
  }

  const isPreview = mode === 'preview';
  const scale = Number(args.flags.scale ?? (isPreview ? 0.5 : 1));
  const crf = Number(args.flags.crf ?? (isPreview ? 26 : 18));
  const suffix = isPreview ? 'preview' : 'final';
  const outFile = path.resolve(args.flags.out ?? path.join(PATHS.render, `${cfg.id}-${suffix}.mp4`));

  if (fs.existsSync(outFile) && !args.flags.force) {
    warn(`输出已存在，将被覆盖: ${outFile}`);
  }

  if (isPreview) {
    warn('预览模式：半分辨率 + 低码率，仅用于验收节奏与构图，不可作为交付。');
  }

  const R = await import('../lib/remotion.mjs');
  let lastPct = -1;
  const res = await R.renderComposition({
    projectDir: dir,
    cfg,
    outFile,
    scale,
    crf,
    concurrency: args.flags.concurrency ? Number(args.flags.concurrency) : null,
    onProgress: ({ progress, encodedFrames }) => {
      const pct = Math.floor(progress * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`\r  渲染 ${pct}%  (${encodedFrames} frames)`);
      }
    },
  });
  process.stdout.write('\n');

  const p = await probe(res.outFile);
  if (!p.ok) { fail(`输出无法探测: ${p.error}`); return 1; }

  // 后期：响度归一（仅完整渲染，预览不动）
  let finalFile = res.outFile;
  let loudness = null;
  if (!isPreview && args.flags['no-loudnorm'] !== true) {
    step('响度归一 (EBU R128 → -14 LUFS)');
    const P = await import('../lib/postproc.mjs');
    const normOut = outFile.replace(/\.mp4$/i, '-loudnorm.mp4');
    const r2 = await P.normalizeLoudness(outFile, normOut);
    if (r2.applied) {
      loudness = r2;
      finalFile = normOut;
      const gainTxt = r2.gainDb !== undefined ? `+${r2.gainDb}dB` : '';
      info(`响度: ${r2.before?.inputI?.toFixed?.(2) ?? '?'} → ${r2.after?.inputI?.toFixed?.(2) ?? '?'} LUFS ${gainTxt}  (峰值 ${r2.after?.inputTp?.toFixed?.(2) ?? '?'} dBTP)`);
      // 用归一版替换交付文件，原始渲染改名保留以便比对
      const rawKeep = outFile.replace(/\.mp4$/i, '-raw.mp4');
      try {
        if (fs.existsSync(rawKeep)) fs.unlinkSync(rawKeep);
        fs.renameSync(outFile, rawKeep);
        fs.renameSync(normOut, outFile);
      } catch (e) { warn(`重命名失败: ${e.message}`); }
      info(`交付文件: ${outFile}`);
      info(`原始渲染: ${rawKeep}（保留作质量对比，可删）`);
    } else {
      warn(`响度归一未生效 (${r2.reason ?? 'unknown'})，保留原始渲染`);
    }
  }

  const p2 = await probe(outFile);
  info(`输出: ${p2.video?.width}x${p2.video?.height} @${p2.video?.fps}fps, ${p2.durationSec.toFixed(2)}s, ${p2.video?.codec}/${p2.audio?.codec ?? 'no-audio'}, ${(p2.sizeBytes / 1024 / 1024).toFixed(2)}MB`);

  if (args.flags.json) {
    jsonOut({ ok: true, outFile, probe: p2, loudness, log: logPath() });
  }
  return 0;
}

/* ---------------- still ---------------- */
async function cmdStill(args) {
  const ref = args.flags.project ?? args._[1];
  const { dir, cfg } = loadProject(ref);
  const frame = Number(args.flags.frame ?? 0);
  if (!Number.isInteger(frame) || frame < 0) { fail('--frame 必须为 >=0 的整数'); return 2; }
  const outFile = path.resolve(args.flags.out ?? path.join(PATHS.out, `${cfg.id}-frame${frame}.png`));

  const R = await import('../lib/remotion.mjs');
  const res = await R.renderComposition({ projectDir: dir, cfg, outFile, stillFrame: frame });
  if (args.flags.json) jsonOut({ ok: true, outFile: res.outFile });
  return 0;
}

/* ---------------- inspect ---------------- */
async function cmdInspect(args) {
  const ref = args.flags.project ?? args._[1];
  const { dir, cfg } = loadProject(ref);
  const file = path.resolve(args.flags.file ?? args.flags.in ?? path.join(PATHS.render, `${cfg.id}-final.mp4`));
  if (!fs.existsSync(file)) { fail(`找不到输出文件: ${file}`); return 2; }

  step('质量检查');
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const p = await probe(file);
  if (!p.ok) { fail(`探测失败: ${p.error}`); return 1; }

  add('分辨率', p.video?.width === cfg.video.width && p.video?.height === cfg.video.height, `${p.video?.width}x${p.video?.height} (期望 ${cfg.video.width}x${cfg.video.height})`);
  add('帧率', Math.abs((p.video?.fps ?? 0) - cfg.video.fps) < 0.05, `${p.video?.fps} (期望 ${cfg.video.fps})`);
  const expDur = cfg.video.durationInFrames / cfg.video.fps;
  add('时长', Math.abs(p.durationSec - expDur) < 0.25, `${p.durationSec.toFixed(2)}s (期望 ${expDur.toFixed(2)}s)`);
  add('视频编码', p.video?.codec === 'h264', `${p.video?.codec} / ${p.video?.pixFmt} ${p.video?.profile ?? ''}`);
  add('音频轨', !!p.audio, p.audio ? `${p.audio.codec} ${p.audio.sampleRate}Hz ${p.audio.channels}ch` : '无音频轨');
  add('文件大小', p.sizeBytes > 50 * 1024, `${(p.sizeBytes / 1024 / 1024).toFixed(2)} MB`);

  // 黑帧 / 亮度检查（快速扫全片）
  const luma = await measureLuma(file);
  if (luma) {
    add('平均亮度', luma.yavgNormalized > 0.005, `YAVG=${luma.yavg} (归一 ${luma.yavgNormalized}) 范围 ${luma.ymin}~${luma.ymax}`);
  }

  const loud = await measureLoudness(file);
  if (loud) {
    const okLoud = loud.inputI > -30 && loud.inputI < -8;
    add('整体响度', okLoud, `${loud.inputI} LUFS (期望 -30 ~ -8)，TP ${loud.inputTp}`);
  }

  const sil = await detectSilence(file, { noiseDb: -45, minDur: 0.25 });
  add('静音段落检测', true, `发现 ${sil.count} 段静音（含设计的硬停段）`);

  // 抽帧图
  const sheet = await (await import('../lib/ffmpeg.mjs')).contactSheet(file, path.join(PATHS.out, `${cfg.id}-contact.png`), { count: 8, cols: 4 });
  if (sheet) add('抽帧图', true, sheet);

  // 抽 3 个关键帧便于人工看
  const keyFrames = [Math.round(expDur * 0.15), Math.round(expDur * 0.45), Math.round(expDur * 0.8)];
  const framesOut = [];
  for (const [i, t] of keyFrames.entries()) {
    const f = path.join(PATHS.out, `${cfg.id}-key${i + 1}.png`);
    if (await extractFrame(file, t, f)) framesOut.push(f);
  }
  if (framesOut.length) add('关键帧', true, framesOut.join(', '));

  const passed = checks.filter((c) => c.ok).length;

  if (args.flags.json) {
    jsonOut({ file, probe: p, checks, luma, loudness: loud, silence: sil, passed, total: checks.length });
    return passed === checks.length ? 0 : 1;
  }

  console.log(`\n检查对象: ${file}\n`);
  for (const c of checks) console.log(`${c.ok ? '✅' : '❌'} ${c.name.padEnd(16)} ${c.detail}`);
  console.log(`\n通过 ${passed}/${checks.length}`);
  return passed === checks.length ? 0 : 1;
}

/* ---------------- main ---------------- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.flags.help) { console.log(HELP); return 0; }

  ensureDirs();
  startLog(cmd, process.argv.slice(3));

  try {
    switch (cmd) {
      case 'doctor': return await cmdDoctor(args);
      case 'init': return await cmdInit(args);
      case 'list': {
        const ps = listProjects();
        if (args.flags.json) { jsonOut(ps); return 0; }
        if (!ps.length) { console.log('暂无工程。'); return 0; }
        for (const p of ps) console.log(`- ${p.id}  ${p.title ?? ''}  ${p.frames ? p.frames + ' frames' : ''}`);
        return 0;
      }
      case 'audio': return await cmdAudio(args);
      case 'captions': return await cmdCaptions(args);
      case 'preview': return await doRender(args, 'preview');
      case 'render': return await doRender(args, 'render');
      case 'still': return await cmdStill(args);
      case 'inspect': return await cmdInspect(args);
      default:
        fail(`未知命令: ${cmd}`);
        console.log(HELP);
        return 2;
    }
  } catch (e) {
    fail(e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
    printFailureSummary(20);
    return e.exitCode ?? 1;
  }
}

main().then((code) => {
  if (code === 0) console.log(`\n日志: ${logPath()}`);
  process.exit(code);
});