#!/usr/bin/env node
/**
 * 生成「明确标记的占位配音」。
 *
 * 使用 Windows 内置 SAPI（Microsoft Huihui Desktop，zh-CN），零成本、离线。
 * 输出文件名强制带 PLACEHOLDER，project.json 里必须标 placeholder:true，
 * 防止被误当作最终真人配音交付。
 *
 * 用法: node tools/make-placeholder-voice.mjs <text> <out.wav>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../engine/lib/log.mjs';

const text = process.argv[2] ?? '这是一段占位配音，不是最终配音。';
const out = path.resolve(process.argv[3] ?? 'out/PLACEHOLDER-voice.wav');

fs.mkdirSync(path.dirname(out), { recursive: true });

// SAPI 直接写 WAV；用 SetOutputToWaveFile
const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Huihui Desktop')
$synth.Rate = 0
$synth.Volume = 100
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Stereo)
$synth.SetOutputToWaveFile('${out.replace(/'/g, "''")}', $fmt)
$synth.Speak('${text.replace(/'/g, "''")}')
$synth.Dispose()
Write-Output 'ok'
`;

const psFile = path.join(process.env.TEMP ?? '.', `linvis-tts-${Date.now()}.ps1`);
fs.writeFileSync(psFile, psScript, 'utf8');

try {
  const r = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], { echo: false });
  if (r.code !== 0) {
    console.error('SAPI 合成失败:', r.stderr);
    process.exit(1);
  }
} finally {
  try { fs.unlinkSync(psFile); } catch { /* ignore */ }
}

if (!fs.existsSync(out)) {
  console.error('未生成输出文件');
  process.exit(1);
}

const st = fs.statSync(out);
console.log(`占位配音已生成: ${out} (${(st.size / 1024).toFixed(1)} KB)`);
console.log('⚠️  文件名含 PLACEHOLDER，不得作为最终交付配音。');
