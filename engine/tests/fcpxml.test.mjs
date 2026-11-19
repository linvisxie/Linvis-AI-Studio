import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { timelineToFcpxml } from '../lib/fcpxml.mjs';

let dir;
const picture = 'picture & apostrophe\' space.mp4';
const sound = 'sound & voice.wav';
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linvis-fcpxml-'));
  const result = spawnSync(process.env.LINVIS_FFMPEG || 'ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=30',
    '-frames:v', '60', '-an', '-c:v', 'mpeg4', path.join(dir, picture),
  ], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  // Exactly 0.5s PCM source: shorter than the timeline. No proprietary fixtures.
  const data = Buffer.alloc(44 + 24000 * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(96000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  fs.writeFileSync(path.join(dir, sound), data);
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function timeline() {
  return {
    timebase: 'frames', video: { width: 1080, height: 1920, fps: 30, durationInFrames: 60 },
    scenes: [
      { sceneId: 'one', kind: 'clip', src: picture, from: 0, durationInFrames: 10 },
      { sceneId: 'two', kind: 'clip', src: picture, from: 20, durationInFrames: 40 },
    ],
    audio: [
      { id: 'voice', src: sound, from: 0, role: 'voice', volume: 0.5 },
      { id: 'bgm', src: sound, from: 12, role: 'music', volume: 1, fadeInFrames: 3, fadeOutFrames: 4 },
    ],
    captions: { enabled: true, src: 'captions.srt' },
  };
}

test('exact frame fractions, gaps, silent spine and independent connected audio lanes', () => {
  const input = timeline(), before = structuredClone(input);
  const xml = timelineToFcpxml(input, { baseDir: dir });
  assert.deepEqual(input, before, 'does not mutate timeline');
  assert.match(xml, /frameDuration="1\/30s"/);
  assert.match(xml, /<sequence[^>]+duration="2\/1s"/);
  assert.match(xml, /name="two" offset="2\/3s" start="0\/1s" duration="4\/3s"/);
  assert.match(xml, /hasVideo="1" hasAudio="0"/);
  assert.match(xml, /<gap name="Gap" offset="1\/3s" start="0\/1s" duration="1\/3s"><asset-clip[^>]*name="bgm" lane="-2" offset="1\/15s"/);
  assert.match(xml, /name="voice" lane="-1"[^>]*duration="1\/2s"/);
  assert.match(xml, /name="bgm" lane="-2"[^>]*duration="1\/2s"/);
  assert.match(xml, /adjust-volume amount="-6.0206dB"/);
  assert.match(xml, /com.linvis.fadeInFrames" value="3"/);
  assert.match(xml, /com.linvis.fadeOutFrames" value="4"/);
  assert.match(xml, /NOT GUARANTEED: metadata only/);
  assert.match(xml, /SRT sidecar only/);
  assert.doesNotMatch(xml, /<title\b|<caption\b/);
});

test('NTSC rational frame rate stays exact, without decimal seconds', () => {
  const input = timeline();
  input.video.fps = '30000/1001';
  input.audio = [];
  const xml = timelineToFcpxml(input, { baseDir: dir });
  assert.match(xml, /frameDuration="1001\/30000s"/);
  assert.match(xml, /duration="1001\/500s"/);
  assert.match(xml, /name="two" offset="1001\/1500s"/);
  assert.doesNotMatch(xml, /(?:duration|offset)="\d+\.\d+s"/);
});

test('file URLs resolve from baseDir, XML attributes are escaped, relocation is explicit', () => {
  const xml = timelineToFcpxml(timeline(), { baseDir: dir, name: 'A <B> & "C"' });
  const url = pathToFileURL(path.join(dir, picture)).href.replaceAll('&', '&amp;').replaceAll("'", '&apos;');
  assert.ok(xml.includes(`src="${url}"`));
  assert.match(xml, /name="A &lt;B&gt; &amp; &quot;C&quot;"/);
  assert.match(xml, /picture &amp; apostrophe&apos; space.mp4/);
  assert.match(xml, /regenerate timeline.fcpxml with new baseDir/);
});

test('refuses missing/unrendered/short scenes rather than silently omitting pictures', () => {
  const input = timeline();
  input.scenes[0].src = 'missing.mp4';
  assert.throws(() => timelineToFcpxml(input, { baseDir: dir }), /Missing media/);
  input.scenes[0] = { ...input.scenes[0], kind: 'unrendered', requiresRender: true };
  assert.throws(() => timelineToFcpxml(input, { baseDir: dir }), /requires rendered video clip/);
  input.scenes = [{ sceneId: 'too-long', kind: 'clip', src: picture, from: 0, durationInFrames: 61 }];
  input.video.durationInFrames = 61;
  assert.throws(() => timelineToFcpxml(input, { baseDir: dir }), /Source shorter than scene/);
});

test('rejects overlaps, missing audio, bad gain and fills an empty spine with a gap', () => {
  const input = timeline();
  input.scenes[1].from = 5;
  assert.throws(() => timelineToFcpxml(input, { baseDir: dir }), /overlap/);
  input.scenes = [];
  input.audio[0].src = 'missing.wav';
  assert.throws(() => timelineToFcpxml(input, { baseDir: dir }), /Missing media/);
  input.audio[0].src = sound;
  input.audio[0].volume = -1;
  assert.throws(() => timelineToFcpxml(input, { baseDir: dir }), /Invalid audio gain/);
  input.audio[0].volume = 0;
  const xml = timelineToFcpxml(input, { baseDir: dir });
  assert.match(xml, /<gap name="Gap" offset="0\/1s" start="0\/1s" duration="2\/1s">/);
  assert.match(xml, /enabled="0"/);
});

const verified = path.resolve('out/handoff/EP01-TechPhilosophy-Act1-v2-verified');
test('verified EP01 fixture: ten picture clips and two audio lanes', {
  skip: !fs.existsSync(path.join(verified, 'timeline.json')),
}, () => {
  const input = JSON.parse(fs.readFileSync(path.join(verified, 'timeline.json'), 'utf8'));
  const xml = timelineToFcpxml(input, { name: 'EP01', baseDir: verified });
  assert.equal((xml.match(/<asset-clip /g) ?? []).length, 12);
  assert.equal((xml.match(/hasVideo="1" hasAudio="0"/g) ?? []).length, 10);
  assert.equal((xml.match(/ lane="-\d+"/g) ?? []).length, 2);
  assert.match(xml, /<sequence[^>]+duration="42\/1s"/);
});
