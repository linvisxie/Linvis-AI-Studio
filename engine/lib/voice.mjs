import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG, measureLoudness, probe } from './ffmpeg.mjs';
import { run } from './log.mjs';

/** Local speech preparation; original file is never modified. No synthetic speech. */
export async function prepareVoice({ input, output, targetI = -18, force = false }) {
  if (!fs.existsSync(input)) throw new Error(`录音不存在: ${input}`);
  if (path.resolve(input) === path.resolve(output)) throw new Error('不得覆盖原始录音');
  if (fs.existsSync(output) && !force) throw new Error(`输出已存在: ${output}（覆盖需 --force）`);
  if (!Number.isFinite(targetI) || targetI < -30 || targetI > -12) throw new Error('语音目标响度须为 -30 到 -12 LUFS');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const before = await measureLoudness(input);
  const r = await run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-i', input,
    '-vn', '-af', `highpass=f=65,loudnorm=I=${targetI}:TP=-1.8:LRA=9`,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output], { echo: false });
  if (r.code !== 0) throw new Error(`人声处理失败: ${r.stderr.slice(-600)}`);
  return { ok: true, input, output, targetI, before, after: await measureLoudness(output), probe: await probe(output),
    operations: ['65Hz 高通（低频环境噪声）', 'EBU R128 响度处理', '48kHz stereo PCM'],
    note: '保留真实声音；不做声线克隆、不补写未录制内容。' };
}
