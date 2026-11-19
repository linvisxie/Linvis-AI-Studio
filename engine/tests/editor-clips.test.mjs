import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderScenes, sceneClipName } from '../lib/render-scenes.mjs';
import { collectSceneClips, buildJianyingDraft, inspectJianyingDraft } from '../adapters/jianying/index.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linvis-editor-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  const cfg = { id: 'temporary-test', video: { width: 64, height: 64, fps: 30, durationInFrames: 4 },
    scenes: [{ id: 'first', type: 'impact-title', from: 0, durationInFrames: 1, props: { text: 'Title' } },
      { id: 'last', type: 'blank', from: 1, durationInFrames: 3 }], audio: { layers: [] }, captions: { enabled: false } };
  const outDir = path.join(root, 'clips');
  const calls = [];
  const runtime = { bridge: { buildInputProps: (_dir, c) => c, findBrowser: () => null },
    bundler: { bundle: async () => 'fake-test-bundle' }, renderer: {
      selectComposition: async () => ({ ...cfg.video, id: 'LinvisVideo' }),
      renderMedia: async (args) => { calls.push(args); fs.writeFileSync(args.outputLocation, `clip:${args.frameRange}`); },
    } };
  const render = (extra = {}) => renderScenes({ projectDir, cfg, outDir, runtime, ...extra });
  const collect = (extra = {}) => collectSceneClips(cfg.id, { projectDir, cfg, outDir, ...extra });
  return { root, projectDir, cfg, outDir, runtime, calls, render, collect };
}

function skeleton(root) {
  const draftRoot = path.join(root, 'drafts');
  const skeletonDir = path.join(draftRoot, 'skeleton');
  const tl = path.join(skeletonDir, 'Timelines', '11111111-1111-1111-1111-111111111111');
  fs.mkdirSync(tl, { recursive: true });
  fs.writeFileSync(path.join(tl, 'template.tmp'), JSON.stringify({ new_version: '75.0.0',
    materials: { videos: [{ id: 'old', path: '/nonexistent' }], audios: [], texts: [] } }));
  return { draftRoot, skeletonDir };
}

test('editor props, silence, exact inclusive ranges, stable IDs and verified reuse', async (t) => {
  const f = fixture(t);
  const r = await f.render();
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls.map((c) => c.frameRange), [[0, 0], [1, 3]]);
  for (const c of f.calls) {
    assert.equal(c.inputProps.renderMode, 'editor');
    assert.equal(c.muted, true);
    assert.equal(c.audioCodec, undefined);
    assert.deepEqual(c.inputProps.audio.layers, []);
    assert.equal(c.composition.durationInFrames, 4);
  }
  assert.equal(f.collect().size, 2);
  assert.equal(collectSceneClips(f.cfg.id, { outDir: f.outDir }), null);
  const subset = await f.render({ only: ['last'] });
  assert.equal(subset.clips[0].reused, true);
  assert.equal(subset.clips[0].file, path.join(f.outDir, sceneClipName('last')));
  assert.equal(f.calls.length, 2);
  assert.equal((await f.render({ only: ['not-found'] })).ok, false);
});

test('config, same-size asset changes, render params and clip corruption invalidate cache', async (t) => {
  const f = fixture(t);
  const asset = path.join(f.projectDir, 'assets', 'input.bin');
  fs.writeFileSync(asset, 'AAAA');
  await f.render();
  f.cfg.scenes[0].props.text = 'Changed';
  assert.equal(f.collect(), null);
  await f.render();
  assert.equal(f.calls.length, 4);
  fs.writeFileSync(asset, 'BBBB');
  assert.equal(f.collect(), null);
  await f.render();
  assert.equal(f.collect({ scale: 0.5 }), null);
  fs.writeFileSync(path.join(f.outDir, sceneClipName('last')), 'corrupt');
  assert.equal(f.collect().has('last'), false);
  await f.render();
  assert.equal(f.calls.length, 7);
});

test('partial failures, empty outputs and out-of-bounds never report success', async (t) => {
  const f = fixture(t);
  f.runtime.renderer.renderMedia = async (a) => {
    if (a.frameRange[0] === 1) { fs.writeFileSync(a.outputLocation, 'partial'); throw new Error('test failure'); }
    fs.writeFileSync(a.outputLocation, 'ok');
  };
  const r = await f.render();
  assert.equal(r.ok, false);
  assert.equal(r.skipped.length, 1);
  assert.equal(f.collect().size, 1);
  assert.equal(fs.readdirSync(f.outDir).some((s) => s.startsWith('.')), false);
  f.cfg.scenes[1].durationInFrames = 4;
  assert.equal((await f.render()).ok, false);
  await assert.rejects(f.render({ cfg: { ...f.cfg, id: '../escape' } }), /project id/);
});

test('adapter stages content hashes, uses absolute paths, no duplicate rendered title', async (t) => {
  const f = fixture(t);
  const a = path.join(f.projectDir, 'assets', 'a'), b = path.join(f.projectDir, 'assets', 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'same.wav'), 'AAAA');
  fs.writeFileSync(path.join(b, 'same.wav'), 'BBBB');
  fs.writeFileSync(path.join(f.projectDir, 'assets', 'captions.json'), JSON.stringify({ captions: [{ text: 'Native caption', from: 0, to: 4 }] }));
  f.cfg.audio.layers = [{ src: 'a/same.wav' }, { src: 'b/same.wav' }];
  f.cfg.captions = { enabled: true, src: 'captions.json' };
  await f.render();
  const opts = { projectDir: f.projectDir, cfg: f.cfg, ...skeleton(f.root), name: 'generated', sceneClips: f.collect() };
  const r = buildJianyingDraft(opts);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sceneClipsUsed, ['first', 'last']);
  const data = JSON.parse(fs.readFileSync(path.join(r.draftDir, 'draft_content.json'), 'utf8'));
  assert.equal(data.tracks.some((s) => s.name === '标题'), false);
  assert.equal(data.tracks.find((s) => s.name === '字幕').segments.length, 1);
  const audios = data.materials.audios;
  assert.notEqual(audios[0].path, audios[1].path);
  assert.equal(fs.readFileSync(audios[0].path, 'utf8'), 'AAAA');
  assert.equal(fs.readFileSync(audios[1].path, 'utf8'), 'BBBB');
  assert.ok([...audios, ...data.materials.videos].every((s) => path.isAbsolute(s.path)));
  assert.ok(data.materials.videos.every((s) => s.has_audio === false));
  assert.equal(inspectJianyingDraft(r.draftDir).ok, true);
  assert.equal(buildJianyingDraft({ ...opts, force: true }).ok, true);
  const userFile = path.join(r.draftDir, 'user-notes.txt');
  fs.writeFileSync(userFile, 'keep my notes');
  assert.equal(buildJianyingDraft({ ...opts, force: true }).ok, false);
  assert.equal(fs.readFileSync(userFile, 'utf8'), 'keep my notes');
  fs.unlinkSync(userFile);
  fs.writeFileSync(path.join(r.draftDir, 'draft_content.json'), 'user edits');
  assert.equal(buildJianyingDraft({ ...opts, force: true }).ok, false);
  assert.equal(fs.readFileSync(path.join(r.draftDir, 'draft_content.json'), 'utf8'), 'user edits');
});

test('adapter rejects traversal, skeleton overwrite, arbitrary user drafts and stale supplied maps', async (t) => {
  const f = fixture(t);
  const opts = { projectDir: f.projectDir, cfg: f.cfg, ...skeleton(f.root), name: 'generated', force: true };
  for (const name of ['..', '../escape', 'x/y', 'C:\\escape', 'NUL', 'name.']) {
    assert.equal(buildJianyingDraft({ ...opts, name }).ok, false);
  }
  assert.equal(buildJianyingDraft({ ...opts, name: 'skeleton' }).ok, false);
  const user = path.join(opts.draftRoot, 'user');
  fs.mkdirSync(user); fs.writeFileSync(path.join(user, 'important'), 'keep');
  assert.equal(buildJianyingDraft({ ...opts, name: 'user' }).ok, false);
  assert.equal(fs.readFileSync(path.join(user, 'important'), 'utf8'), 'keep');
  await f.render();
  const stale = f.collect();
  f.cfg.scenes[0].props.text = 'new title';
  const r = buildJianyingDraft({ ...opts, sceneClips: stale });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sceneClipsUsed, []);
});

test('real Remotion smoke: 1/3 frames, no audio, verified reuse', { skip: process.env.LINVIS_RENDER_TEST !== '1', timeout: 180000 }, async (t) => {
  const f = fixture(t);
  const r = await f.render({ runtime: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const clip of r.clips) {
    const p = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', clip.file], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const streams = JSON.parse(p.stdout).streams;
    assert.equal(streams.filter((s) => s.codec_type === 'audio').length, 0);
    const video = streams.find((s) => s.codec_type === 'video');
    assert.equal(Number(video.nb_read_frames), clip.durationInFrames);
    assert.equal(video.width, 64);
    assert.equal(video.height, 64);
  }
  assert.equal(f.collect().size, 2);
  assert.ok((await f.render({ runtime: null })).clips.every((c) => c.reused));
});
