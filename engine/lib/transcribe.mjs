/**
 * 配音转写桥：优先项目级 .venv 的 faster-whisper，回退到系统 openai-whisper。
 * 输出统一为 Remotion 可直接消费的字幕 JSON（帧为单位）。
 *
 * 重要：两个引擎的模型名不通用。
 *   - faster-whisper 用 CTranslate2 的 HF 快照（tiny/base/small/medium/large-v3）
 *   - openai-whisper 用 .pt 权重（tiny/base/small/medium/large）
 * 未显式指定 model 时，按引擎各自的默认值走。
 */
import path from 'node:path';
import fs from 'node:fs';
import { PATHS } from './project.mjs';
import { run, info, warn, step, logLine } from './log.mjs';

/** 找到可用的 python 解释器（优先项目级 .venv）。 */
export function findPython() {
  const venvPy = path.join(PATHS.root, '.venv', 'Scripts', 'python.exe');
  const venvPyPosix = path.join(PATHS.root, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPy)) return { cmd: venvPy, source: 'project-venv' };
  if (fs.existsSync(venvPyPosix)) return { cmd: venvPyPosix, source: 'project-venv' };
  return { cmd: process.platform === 'win32' ? 'py' : 'python3', source: 'system' };
}

/** 检查两种转写能力，返回可用引擎及其对应解释器。 */
export async function detectEngine() {
  const sysCmd = process.platform === 'win32' ? 'py' : 'python3';
  const venv = findPython();

  // 同一段代码可能在两个解释器下表现不同，因此两个都探测
  const probes = [];
  if (venv.source === 'project-venv') probes.push(venv);
  probes.push({ cmd: sysCmd, source: 'system' });

  const results = [];
  for (const p of probes) {
    const fw = await run(p.cmd, ['-c', 'import faster_whisper;print(faster_whisper.__version__)'], { echo: false });
    if (fw.code === 0) results.push({ engine: 'faster-whisper', version: fw.stdout.trim(), python: p.cmd, source: p.source });

    const ow = await run(p.cmd, ['-c', 'import whisper;print("ok")'], { echo: false });
    if (ow.code === 0) results.push({ engine: 'openai-whisper', version: 'ok', python: p.cmd, source: p.source });
  }

  if (!results.length) {
    return { available: false, engine: null, python: sysCmd, source: 'none', hint: '未安装 faster-whisper 或 openai-whisper', all: [] };
  }

  const primary = results[0];
  return { available: true, ...primary, all: results };
}

/**
 * 转写音频生成字幕。
 * @param {object} p
 * @param {string} p.audioFile
 * @param {string|null} p.model  引擎默认模型；null = 自动
 * @param {'auto'|'faster-whisper'|'openai-whisper'} p.engine
 */
export async function transcribeToCaptions({
  audioFile,
  model = null,
  language = 'zh',
  fps = 30,
  initialPrompt = null,
  engine = 'auto',
}) {
  const eng = await detectEngine();
  if (!eng.available) {
    const err = new Error(
      `转写引擎不可用: ${eng.hint}\n` +
      `项目级安装: .venv\\Scripts\\python.exe -m pip install faster-whisper`,
    );
    err.exitCode = 1;
    throw err;
  }

  // 按优先级尝试每个可用的 (解释器, 引擎) 组合，失败自动换下一个
  const attempts = eng.all ?? [{ engine: eng.engine, python: eng.python, source: eng.source }];
  const ordered = attempts
    .filter((a) => engine === 'auto' || a.engine === engine)
    .sort((a, b) => (a.engine === 'faster-whisper' ? -1 : 1) - (b.engine === 'faster-whisper' ? -1 : 1));

  const failures = [];
  for (const cand of ordered) {
    const resolvedModel = model ?? (cand.engine === 'faster-whisper' ? 'small' : 'base');
    info(`转写尝试: ${cand.engine} (${cand.source}, model=${resolvedModel})`);

    const outJson = path.join(path.dirname(audioFile), `.transcribe-tmp-${Date.now()}.json`);
    const args = [
      path.join(PATHS.engine, 'py', 'transcribe.py'),
      '--audio', audioFile,
      '--out', outJson,
      '--model', resolvedModel,
      '--language', language,
      '--fps', String(fps),
      '--engine', cand.engine,
    ];
    if (initialPrompt) args.push('--initial-prompt', initialPrompt);

    const r = await run(cand.python, args, { echo: true });
    if (r.code === 0 && fs.existsSync(outJson)) {
      const data = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      try { fs.unlinkSync(outJson); } catch { /* ignore */ }
      if (data.ok) {
        logLine(`transcribe ok: ${data.engine}, ${data.captions.length} caps, ${data.words.length} words`);
        return data;
      }
      failures.push(`${cand.engine}: ${data.error}`);
    } else {
      failures.push(`${cand.engine} (exit ${r.code})`);
      try { fs.unlinkSync(outJson); } catch { /* ignore */ }
    }
    warn(`${cand.engine} 不可用，尝试下一个引擎`);
  }

  const err = new Error(`所有转写引擎均失败:\n  ${failures.join('\n  ')}`);
  err.exitCode = 1;
  throw err;
}
