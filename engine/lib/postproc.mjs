/**
 * 成片后期处理：响度归一到社交平台标准（EBU R128）。
 *
 * 策略：先实测 integrated loudness，再计算增益，最后用限幅器压住峰值。
 * 之所以不用 loudnorm 单通道：程序化合成的撞击音动态极大（crest ~15dB），
 * linear=true 会被峰值卡住，linear=false 又会过度压缩。volume+alimiter 更可控。
 */
import fs from 'node:fs';
import { run, logLine } from './log.mjs';
import { FFMPEG, probe, measureLoudness } from './ffmpeg.mjs';

/**
 * @param {string} inputFile
 * @param {string} outputFile
 * @param {{targetI?:number, limitDbfs?:number, maxGainDb?:number}} opts
 */
export async function normalizeLoudness(inputFile, outputFile, opts = {}) {
  const { targetI = -14, limitDbfs = -1.6, maxGainDb = 9 } = opts;

  const before = await measureLoudness(inputFile);
  if (!before || !Number.isFinite(before.inputI)) {
    logLine('loudnorm: 无法测量输入响度，跳过');
    return { applied: false, before, reason: 'measure-failed' };
  }

  let gainDb = targetI - before.inputI;
  // 不无限推增益，避免把噪声底噪一起放大
  gainDb = Math.max(0, Math.min(maxGainDb, gainDb));

  if (gainDb < 0.2) {
    logLine(`loudnorm: 已达标 (${before.inputI} LUFS)，无需归一`);
    return { applied: false, before, gainDb: 0, reason: 'already-on-target' };
  }

  // 限幅器：attack 5ms / release 50ms，把峰值压在 limitDbfs
  const limit = Math.pow(10, limitDbfs / 20);
  const filter = `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit.toFixed(4)}:attack=5:release=50:level=false`;

  const r = await run(FFMPEG, [
    '-hide_banner', '-nostdin', '-y', '-i', inputFile,
    '-c:v', 'copy',
    '-af', filter,
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-movflags', '+faststart',
    outputFile,
  ], { echo: false });

  if (r.code !== 0) {
    logLine(`响度归一失败: ${r.stderr.slice(-600)}`);
    return { applied: false, before, error: r.stderr.slice(-400) };
  }

  const after = await measureLoudness(outputFile);
  const p = await probe(outputFile);

  return {
    applied: true,
    before,
    after,
    gainDb: Math.round(gainDb * 100) / 100,
    target: { I: targetI, limitDbfs },
    sizeBytes: p.sizeBytes,
    durationSec: p.durationSec,
    filter,
  };
}

/** 判断当前文件是否已是规范的 limited-range yuv420p。 */
export async function checkColorRange(file) {
  const p = await probe(file);
  if (!p.ok || !p.video) return { ok: false, pixFmt: null };
  const vs = p.raw?.streams?.find?.((s) => s.codec_type === 'video');
  return {
    ok: p.video.pixFmt === 'yuv420p',
    pixFmt: p.video.pixFmt,
    colorSpace: vs?.color_space ?? null,
    colorRange: vs?.color_range ?? null,
    colorPrimaries: vs?.color_primaries ?? null,
  };
}

/** 清理临时文件（渲染中间产物）。 */
export function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
  }
}
