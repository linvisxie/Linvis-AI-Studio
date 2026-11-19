/**
 * 口播侧链压缩（ducking）：真人说话时自动压低背景音乐，说完平滑恢复。
 *
 * 用 FFmpeg 的 sidechaincompress —— 它把「配音」作为 key 信号去压「BGM」，
 * 属于前馈式压缩，不改变人声本身，只动音乐轨。这是口播视频的硬需求：
 * BGM 压不住人声，成片就没法听。
 *
 * 为什么不用 amix + 手写音量包络：
 *   - 手写包络要对每个停顿做检测，中文口播停顿密度高，容易抖
 *   - sidechaincompress 用音频能量本身驱动，天然跟随，且 release 可平滑恢复
 */
import fs from 'node:fs';
import path from 'node:path';
import { run, logLine } from './log.mjs';
import { FFMPEG, hasFilter, probe, measureLoudness } from './ffmpeg.mjs';

/** 默认参数：口播场景的稳妥值。 */
export const DEFAULT_DUCK = {
  threshold: 0.05,   // 触发阈值（线性），0.05 ≈ -26dBFS，正常说话即触发
  ratio: 8,          // 压缩比，8:1 足够把音乐压到明显后退
  attack: 20,        // 起始时间 ms，太快会切掉字头，20ms 最自然
  release: 400,      // 恢复时间 ms，慢一点避免音乐来回抽动
  makeup: 1,         // 不额外补增益，避免压完又变响
  musicGain: 1.0,    // 音乐干声前置增益
  voiceGain: 1.0,    // 人声增益（保持原样）
};

/**
 * 把配音与音乐合成为一条 ducked 音轨。
 *
 * @param {object} opts
 * @param {string} opts.voice   真人配音 wav/mp3
 * @param {string} opts.music   背景音乐
 * @param {string} opts.output  输出文件
 * @param {object} [opts.duck]  覆盖 DEFAULT_DUCK 的参数
 * @param {boolean} [opts.compare] 是否额外输出「未压缩」版本用于 A/B 试听
 * @param {string} [opts.musicOutput] 独立音乐 stem，默认 output 同目录 ducked-music.wav
 * @param {boolean} [opts.force=false] 是否允许覆盖输出（从不允许覆盖输入）
 */
export async function duckMusic(opts) {
  const { voice, music, output, compare = false, force = false } = opts;
  const cfg = { ...DEFAULT_DUCK, ...(opts.duck ?? {}) };
  const ranges = { threshold: [0.00097563, 1], ratio: [1, 20], attack: [0.01, 2000],
    release: [0.01, 9000], makeup: [1, 64], musicGain: [0, 16], voiceGain: [0, 16] };
  for (const [key, value] of Object.entries(cfg)) {
    if (!ranges[key] || !Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1]) {
      return { ok: false, error: `无效 duck 参数 ${key}: ${value}` };
    }
  }
  if (typeof output !== 'string' || !/\.wav$/i.test(output)) return { ok: false, error: 'output 必须为 .wav 文件' };
  const musicOutput = opts.musicOutput ?? path.join(path.dirname(output), 'ducked-music.wav');
  const plain = output.replace(/\.wav$/i, '.flat.wav');
  const outputs = [output, musicOutput, ...(compare ? [plain] : [])].map((f) => path.resolve(f));
  if (new Set(outputs).size !== outputs.length || outputs.some((f) => [voice, music].some((src) => src && path.resolve(src) === f))) {
    return { ok: false, error: '输出路径不能相互重复或覆盖输入文件' };
  }
  for (const file of outputs) {
    if (fs.existsSync(file) && (!force || !fs.lstatSync(file).isFile())) return { ok: false, error: `输出已存在或不是普通文件: ${file}` };
    // Reject hardlink/symlink aliases of the input even with force.
    if (fs.existsSync(file) && [voice, music].some((src) => src && fs.existsSync(src)
      && fs.statSync(src).dev === fs.statSync(file).dev && fs.statSync(src).ino === fs.statSync(file).ino)) {
      return { ok: false, error: `输出引用输入文件: ${file}` };
    }
  }

  for (const [k, f] of [['voice', voice], ['music', music]]) {
    if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      return { ok: false, error: `缺少${k === 'voice' ? '配音' : '音乐'}文件: ${f}` };
    }
  }

  if (!(await hasFilter('sidechaincompress'))) {
    return { ok: false, error: '当前 FFmpeg 不支持 sidechaincompress 滤镜' };
  }

  const vp = await probe(voice);
  const mp = await probe(music);
  if (!vp.ok || !mp.ok || !vp.audio || !mp.audio || !(vp.durationSec > 0) || !(mp.durationSec > 0)) {
    return { ok: false, error: '输入必须是可探测且时长大于零的音频文件' };
  }
  for (const file of outputs) fs.mkdirSync(path.dirname(file), { recursive: true });

  // 音乐按配音长度循环补齐，再裁到配音长度，保证两者对齐。
  // 配音要被用两次（一次作 sidechain key，一次混音），必须 asplit 复制。
  const filter = [
    `[0:a]volume=${cfg.voiceGain},asplit=2[vkey][vmix]`,
    `[1:a]volume=${cfg.musicGain},aloop=loop=-1:size=2e9,atrim=0:${vp.durationSec}[m]`,
    `[m][vkey]sidechaincompress=threshold=${cfg.threshold}:ratio=${cfg.ratio}`
      + `:attack=${cfg.attack}:release=${cfg.release}:makeup=${cfg.makeup},asplit=2[ducked][stem]`,
    `[vmix][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
  ].join(';');

  const args = [
    '-hide_banner', '-nostdin', force ? '-y' : '-n',
    '-i', voice,
    '-i', music,
    '-filter_complex', filter,
    '-map', '[out]',
    '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
    output,
    '-map', '[stem]', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', musicOutput,
  ];

  const r = await run(FFMPEG, args, { echo: false });
  if (r.code !== 0) {
    logLine(`sidechain 失败: ${r.stderr.slice(-800)}`);
    return { ok: false, error: r.stderr.slice(-500), filter };
  }

  const result = {
    ok: true,
    output,
    musicOutput,
    duck: cfg,
    voice: { file: voice, durationSec: vp.durationSec },
    music: { file: music, durationSec: mp.durationSec },
    filter,
  };

  const before = await measureLoudness(output);
  result.loudness = before;

  // A/B 试听：同样两轨但不压缩，用于人工对比
  if (compare) {
    const flatFilter = [
      `[0:a]volume=${cfg.voiceGain}[v]`,
      `[1:a]volume=${cfg.musicGain},aloop=loop=-1:size=2e9,atrim=0:${vp.durationSec}[m]`,
      `[v][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
    ].join(';');
    const r2 = await run(FFMPEG, [
      '-hide_banner', '-nostdin', force ? '-y' : '-n',
      '-i', voice, '-i', music,
      '-filter_complex', flatFilter,
      '-map', '[out]',
      '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
      plain,
    ], { echo: false });
    if (r2.code === 0) {
      result.compare = {
        file: plain,
        loudness: await measureLoudness(plain),
      };
    } else {
      result.compare = { error: r2.stderr.slice(-300) };
    }
  }

  return result;
}

/**
 * 用一个 recipe（BGM 配方名）与配音做 ducking。
 * 供 CLI `linvis duck <project>` 使用：项目里 audio.layers 按 id 找 voice / music。
 */
export async function duckProjectLayers({ layers = [], assetsDir, output, musicOutput, duck, compare, force = false }) {
  const voiceLayer = layers.find((l) => l.role === 'voice') ?? layers.find((l) => !l.role && l.id === 'voice');
  const musicLayer = layers.find((l) => l.role === 'music') ?? layers.find((l) => !l.role && ['bgm', 'music'].includes(l.id));
  if (!voiceLayer || !musicLayer) {
    return {
      ok: false,
      error: '工程 audio.layers 里需要同时有配音轨（role:"voice"）与音乐轨（role:"music"）',
    };
  }
  for (const key of ['voiceGain', 'musicGain']) {
    if (duck?.[key] !== undefined && (!Number.isFinite(duck[key]) || duck[key] < 0 || duck[key] > 4)) {
      return { ok: false, error: `无效 duck 参数 ${key}` };
    }
  }
  for (const layer of [voiceLayer, musicLayer]) {
    if (layer.volume !== undefined && (!Number.isFinite(layer.volume) || layer.volume < 0 || layer.volume > 4)) {
      return { ok: false, error: `无效 layer.volume: ${layer.id}` };
    }
  }
  const resolve = (src) => src ? (path.isAbsolute(src) ? src : path.resolve(assetsDir, src)) : null;
  return duckMusic({
    voice: resolve(voiceLayer.src),
    music: resolve(musicLayer.src),
    output,
    musicOutput,
    force,
    duck: { ...duck, voiceGain: (duck?.voiceGain ?? 1) * (voiceLayer.volume ?? 1),
      musicGain: (duck?.musicGain ?? 1) * (musicLayer.volume ?? 1) },
    compare,
  });
}
