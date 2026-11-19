/** Read-only verification of a generated handoff and optional repeated delivery renders. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { probe } from '../engine/lib/ffmpeg.mjs';
import { loadProject } from '../engine/lib/project.mjs';

const root = path.resolve(process.argv[2] ?? 'out/handoff/EP01-TechPhilosophy-Act1-v2');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const timeline = JSON.parse(fs.readFileSync(path.join(root, 'timeline.json'), 'utf8'));
const { cfg } = loadProject(root);
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const asset of manifest.assets) {
  const file = path.resolve(root, asset.path);
  assert.ok(file.startsWith(root + path.sep), 'asset outside package');
  assert.equal(hash(file), asset.sha256, asset.path);
}
const checkSource = (src) => assert.ok(!path.isAbsolute(src) && fs.existsSync(path.resolve(root, 'assets', src)), `unresolvable portable source ${src}`);
for (const scene of cfg.scenes) for (const key of ['src', 'image']) if (scene.props?.[key]) checkSource(scene.props[key]);
for (const layer of cfg.audio?.layers ?? []) checkSource(layer.src);
if (cfg.captions?.enabled) checkSource(cfg.captions.src);
const clips = [];
for (const scene of timeline.scenes) {
  assert.equal(scene.kind, 'clip', `${scene.sceneId} unrendered`);
  assert.equal(scene.validated, true, scene.sceneId);
  const media = await probe(path.resolve(root, scene.src));
  assert.ok(media.ok, scene.sceneId);
  assert.equal(media.audio, null, `${scene.sceneId} must be silent`);
  assert.equal(media.video.frames, scene.durationInFrames, `${scene.sceneId} frame count`);
  assert.equal(media.video.width, cfg.video.width);
  assert.equal(media.video.height, cfg.video.height);
  assert.equal(media.video.fps, cfg.video.fps);
  clips.push({ sceneId: scene.sceneId, frames: media.video.frames, audioTracks: 0 });
}
let repeatedRenders = null;
if (process.argv[3] && process.argv[4]) {
  const a = await probe(path.resolve(process.argv[3])), b = await probe(path.resolve(process.argv[4]));
  assert.ok(a.ok && b.ok);
  const key = (p) => ({ duration: p.durationSec, video: p.video, audio: p.audio });
  assert.deepEqual(key(a), key(b), 'repeat ffprobe parameters');
  repeatedRenders = { parametersMatch: true, parameters: key(a), byteIdentical: hash(a.file) === hash(b.file) };
}
console.log(JSON.stringify({ ok: true, package: root, assets: manifest.assets.length, configReferencesResolve: true, clips, repeatedRenders, editorImport: manifest.editorImport }, null, 2));
