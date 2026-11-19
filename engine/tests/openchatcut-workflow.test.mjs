import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readSnapshot, srtPages, validateTimeline, mapPoolSources } from '../adapters/openchatcut/index.mjs';

const digest = (s) => createHash('sha256').update(s).digest('hex');
function archiveFixture(change = () => {}) {
  const original = { timeline: { items: [{ text: '人工智能与人类'.repeat(1500) }] } };
  const body = JSON.stringify(original), sha = digest(body);
  return { original, client: { async call(name, args) {
    if (name === 'read_project') return { archived: true, artifactId: 'fixture', bodySha256: sha };
    assert.equal(name, 'read_agent_artifact');
    const next = Math.min(body.length, args.offset + args.limit);
    const page = { content: body.slice(args.offset, next), offset: args.offset, totalChars: body.length, bodySha256: sha, hasMore: next < body.length, nextOffset: next };
    change(page, args);
    return page;
  } } };
}
test('official archived results are read through all bounded pages with actual digest verification', async () => {
  const f = archiveFixture();
  assert.deepEqual(await readSnapshot(f.client, 'sid'), f.original);
});
for (const [label, change] of [
  ['non-contiguous pages', (p) => { p.nextOffset++; }],
  ['changed total', (p, a) => { if (a.offset) p.totalChars++; }],
  ['same-length changed body', (p) => { p.content = p.content.replace('人工', '错误'); }],
  ['redacted archive', (p) => { p.redacted = true; }],
  ['changed identity', (p) => { p.bodySha256 = '0'.repeat(64); }],
]) test(`archive rejects ${label}`, async () => {
  await assert.rejects(readSnapshot(archiveFixture(change).client, 'sid'));
});
test('SRT converts semantic captions to exact editor-frame spans', () => {
  assert.deepEqual(srtPages('1\n00:00:01,550 --> 00:00:03,630\nAI 要取代人类了！\n', 30), [
    { text: 'AI 要取代人类了！', fromFrame: 47, durationInFrames: 62 },
  ]);
});
function fixture() {
  const pkg = { timeline: { video: { width: 1080, height: 1920, fps: 30, durationInFrames: 120 },
    scenes: [{ src: 'assets/picture.mp4', from: 0, durationInFrames: 120 }],
    audio: [{ id: 'voice', src: 'assets/voice.wav', from: 30, volume: 0.8, fadeInFrames: 3, fadeOutFrames: 6 }] },
    captions: [{ text: '可编辑字幕', fromFrame: 20, durationInFrames: 60 }],
    assetIds: { 'assets/picture.mp4': 'video-id', 'assets/voice.wav': 'voice-id' }, audioFrames: { voice: 90 } };
  const source = (name, id, frames) => ({ name, sourceAssetId: id, resolvedSourceAssetId: id, sourceStartFrame: 0, sourceDurationInFrames: frames, linkStatus: 'linked' });
  const project = { timeline: { width: 1080, height: 1920, fps: 30,
    tracks: [{ id: 'v1', alias: 'V1' }, { id: 'v2', alias: 'V2' }, { id: 'a1', alias: 'A1' }],
    items: [
      { kind: 'video', trackId: 'v1', startFrame: 0, durationInFrames: 120, ...source('picture.mp4', 'video-id', 120) },
      { kind: 'audio', trackId: 'a1', startFrame: 30, durationInFrames: 90, volume: 0.8, fadeInFrames: 3, fadeOutFrames: 6, ...source('voice.wav', 'voice-id', 90) },
      { kind: 'text', trackId: 'v2', startFrame: 20, durationInFrames: 60, props: { text: '可编辑字幕', fontSize: 52 }, transform: { y: 30 } },
    ] } };
  return { pkg, project };
}
test('pool mapping clips audio to the lesser of source duration and remaining timeline', () => {
  const { pkg } = fixture();
  mapPoolSources(pkg, { mediaPool: { assets: [
    { id: 'video-id', name: 'picture.mp4', durationInFrames: 120 },
    { id: 'voice-id', name: 'voice.wav', durationInFrames: 200 },
  ] } });
  assert.equal(pkg.audioFrames.voice, 90);
  assert.equal(pkg.assetIds['assets/voice.wav'], 'voice-id');
});
test('timeline verification checks exact source IDs/windows, track gain/fades and subtitle content', () => {
  const f = fixture(); assert.equal(validateTimeline(f.project, f.pkg).durationInFrames, 120);
});
for (const [label, mutate] of [
  ['wrong linked source', (p) => { p.timeline.items[0].resolvedSourceAssetId = 'other'; }],
  ['slipped source window', (p) => { p.timeline.items[0].sourceStartFrame = 1; }],
  ['audio past timeline end', (p) => { p.timeline.items[1].durationInFrames = 120; }],
  ['wrong audio gain', (p) => { p.timeline.items[1].volume = 1; }],
  ['wrong audio fade', (p) => { p.timeline.items[1].fadeOutFrames = 0; }],
  ['wrong audio track', (p) => { p.timeline.items[1].trackId = 'v2'; }],
  ['different subtitle', (p) => { p.timeline.items[2].props.text = '错误'; }],
  ['wrong subtitle position', (p) => { p.timeline.items[2].transform.y = 0; }],
]) test(`timeline verification rejects ${label}`, () => {
  const f = fixture(); mutate(f.project); assert.throws(() => validateTimeline(f.project, f.pkg));
});
