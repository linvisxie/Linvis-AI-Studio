import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildHandoff, captionsToSrt } from '../lib/handoff.mjs';
import { duckMusic, duckProjectLayers } from '../lib/sidechain.mjs';
import { FFMPEG, probe } from '../lib/ffmpeg.mjs';
import { hashFile, sceneRenderIdentity, sceneClipName } from '../lib/render-scenes.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linvis-handoff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectDir = path.join(root, 'project'), outDir = path.join(root, 'handoff');
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'photo.png'), 'image bytes');
  fs.writeFileSync(path.join(projectDir, 'assets', 'voice.wav'), 'audio bytes');
  fs.writeFileSync(path.join(projectDir, 'assets', 'captions.json'), JSON.stringify({ fps: 30,
    captions: [{ from: 0, to: 45, text: '校对后的短句' }, { from: 45, to: 90, text: '保留语义边界' }],
    words: [{ text: '这是一段需要分割的中文字幕每页不能超过十六个字符', from: 15, to: 75 }] }));
  const cfg = { id: 'test', title: 'Test', video: { width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
    scenes: [{ id: 'image', type: 'image-scene', from: 0, durationInFrames: 30, props: { src: 'photo.png' } },
      { id: 'title', type: 'impact-title', from: 30, durationInFrames: 60, props: { text: 'title' } }],
    audio: { layers: [{ id: 'voice', role: 'voice', src: 'voice.wav', from: 0, volume: 0.75 }] },
    captions: { enabled: true, src: 'captions.json' }, licenses: [{ asset: 'photo.png', license: 'CC0', source: 'test fixture' }] };
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(cfg));
  return { root, projectDir, outDir, cfg };
}

test('handoff is portable, content addressed, read-only, and native audio is not doubled', async (t) => {
  const f = fixture(t), before = hashFile(path.join(f.projectDir, 'project.json')), original = JSON.stringify(f.cfg);
  // An unreferenced asset still travels; equal bytes deduplicate safely.
  fs.copyFileSync(path.join(f.projectDir, 'assets/photo.png'), path.join(f.projectDir, 'assets/duplicate.png'));
  const result = await buildHandoff(f);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(f.cfg), original);
  assert.equal(hashFile(path.join(f.projectDir, 'project.json')), before);
  for (const asset of result.manifest.assets) {
    assert.equal(path.isAbsolute(asset.path), false);
    assert.equal(hashFile(path.join(f.outDir, asset.path)), asset.sha256);
    assert.ok(path.basename(asset.path).startsWith(asset.sha256));
  }
  const portable = JSON.parse(fs.readFileSync(path.join(f.outDir, 'project.json')));
  for (const src of [portable.scenes[0].props.src, portable.audio.layers[0].src, portable.captions.src, portable.licenses[0].asset]) {
    assert.ok(!src.startsWith('assets/'));
    assert.ok(fs.existsSync(path.join(f.outDir, 'assets', src)));
  }
  assert.equal(result.timeline.audio.length, 1);
  assert.equal(result.timeline.audio[0].src, `assets/${portable.audio.layers[0].src}`);
  assert.equal(result.timeline.scenes[0].src, `assets/${portable.scenes[0].props.src}`);
  // Round trip with the normal assets-relative contract; no assets/assets lookup needed.
  const relocated = path.join(f.root, 'relocated');
  fs.renameSync(f.outDir, relocated);
  const roundTrip = await buildHandoff({ projectDir: relocated, cfg: portable, outDir: path.join(f.root, 'round-trip') });
  assert.equal(roundTrip.timeline.audio[0].src, result.timeline.audio[0].src);
  fs.renameSync(relocated, f.outDir);
  assert.equal(result.timeline.audio[0].volume, 0.75);
  assert.equal(result.timeline.scenes[0].kind, 'image');
  assert.equal(result.timeline.scenes[1].requiresRender, true);
  const srt = fs.readFileSync(path.join(f.outDir, 'captions.srt'), 'utf8');
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,500\n校对后的短句\n\n2\n00:00:01,500 --> 00:00:03,000\n保留语义边界\n');
  for (const block of srt.trim().split('\n\n')) {
    const lines = block.split('\n');
    assert.match(lines[1], /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/);
    assert.ok(Array.from(lines[2]).length <= 16);
  }
  await assert.rejects(buildHandoff(f), /已存在/);
  await buildHandoff({ ...f, force: true });
});

test('missing materials and unsafe outputs fail before writes, even with force', async (t) => {
  const f = fixture(t);
  f.cfg.scenes[0].props.src = 'missing.png';
  await assert.rejects(buildHandoff(f), /缺少素材/);
  assert.equal(fs.existsSync(f.outDir), false);
  await assert.rejects(buildHandoff({ ...f, outDir: path.join(f.projectDir, 'export'), force: true }), /重叠/);
  assert.throws(() => captionsToSrt({ words: [{ text: '坏时间', from: 20, to: 10 }] }, 30), /时间戳/);
});

test('rendered clips require independent identity and hash validation, not mp4 existence', async (t) => {
  const f = fixture(t), dir = path.join(f.root, 'scenes');
  fs.mkdirSync(dir);
  const scene = f.cfg.scenes[1], file = sceneClipName(scene.id);
  fs.writeFileSync(path.join(dir, file), 'rendered silent clip fixture');
  let result = await buildHandoff({ ...f, sceneClipsDir: dir });
  assert.equal(result.timeline.scenes[1].kind, 'unrendered');
  const identity = sceneRenderIdentity(f.projectDir, f.cfg);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...identity, clips: {
    [scene.id]: { file, from: scene.from, durationInFrames: scene.durationInFrames, sha256: hashFile(path.join(dir, file)) } } }));
  result = await buildHandoff({ ...f, force: true, sceneClipsDir: dir });
  assert.equal(result.timeline.scenes[1].kind, 'clip');
  assert.equal(result.timeline.scenes[1].muted, true);
  fs.appendFileSync(path.join(dir, file), 'tampered');
  result = await buildHandoff({ ...f, force: true, sceneClipsDir: dir });
  assert.equal(result.timeline.scenes[1].kind, 'unrendered');
});

test('duck validates ranges and creates separate music stem and A/B with configured layer gains', async (t) => {
  const f = fixture(t), voice = path.join(f.root, 'voice.wav'), music = path.join(f.root, 'music.wav');
  for (const [file, hz] of [[voice, 440], [music, 220]]) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=0.6`, '-y', file]);
    assert.equal(r.status, 0, r.stderr?.toString());
  }
  const output = path.join(f.root, 'duck', 'mix.wav');
  const args = { layers: [{ id: 'voice', role: 'voice', src: voice, volume: 0.5 },
    { id: 'music', role: 'music', src: music, volume: 0.25 }], assetsDir: f.root, output, compare: true };
  const result = await duckProjectLayers(args);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.duck.voiceGain, 0.5);
  assert.equal(result.duck.musicGain, 0.25);
  assert.ok(result.compare.file.endsWith('.flat.wav'));
  for (const file of [output, result.musicOutput, result.compare.file]) assert.equal((await probe(file)).audio.sampleRate, 48000);
  assert.notEqual(hashFile(output), hashFile(result.musicOutput));
  assert.equal((await duckProjectLayers(args)).ok, false);
  assert.equal((await duckProjectLayers({ ...args, force: true })).ok, true);
  for (const duck of [{ ratio: 21 }, { attack: NaN }, { voiceGain: -1 }, { threshold: '0.1' }]) {
    assert.equal((await duckMusic({ voice, music, output, force: true, duck })).ok, false);
  }
  assert.equal((await duckMusic({ voice, music, output: voice, force: true })).ok, false);
  assert.equal((await duckMusic({ voice: path.join(f.root, 'missing'), music, output, force: true })).ok, false);
  assert.equal((await duckProjectLayers({ ...args, layers: args.layers.map((l) => ({ ...l, volume: 5 })) })).ok, false);
});
