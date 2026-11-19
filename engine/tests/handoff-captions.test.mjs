import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { captionsToSrt } from '../lib/handoff.mjs';

const blocks = (srt) => srt.trim().split('\n\n').map((block) => block.split('\n'));

test('display pages win over captions and ASR, without joining adjacent short phrases', () => {
  const data = { fps: 30,
    pages: [{ text: '校对短句', fromSec: 1, toSec: 2 }, { text: '下一句', fromSec: 2, toSec: 3 }],
    captions: [{ text: '旧段落', from: 0, to: 90 }],
    words: [{ text: '错误ASR', from: 0, to: 90 }] };
  assert.deepEqual(blocks(captionsToSrt(data, 60)), [
    ['1', '00:00:01,000 --> 00:00:02,000', '校对短句'],
    ['2', '00:00:02,000 --> 00:00:03,000', '下一句'],
  ]);
  assert.throws(() => captionsToSrt({ ...data, pages: [{ text: '坏时间', from: 20, to: 10 }] }, 30), /时间戳/);
});

test('empty display collections fall back to word timing and grouping', () => {
  const srt = captionsToSrt({ fps: 30, pages: [], captions: [],
    words: [{ text: 'Hello', from: 15, to: 30 }, { word: 'world', start: 1, end: 1.5 }] }, 60);
  assert.equal(srt, '1\n00:00:00,500 --> 00:00:01,500\nHello world\n');
});

test('long display text splits at <=16 Unicode code points with proportional timing', () => {
  const text = '😀'.repeat(20);
  const cues = blocks(captionsToSrt({ captions: [{ text, from: 0, to: 60 }] }, 30));
  assert.deepEqual(cues.map((cue) => Array.from(cue[2]).length), [16, 4]);
  assert.equal(cues[0][1], '00:00:00,000 --> 00:00:01,600');
  assert.equal(cues[1][1], '00:00:01,600 --> 00:00:02,000');
});

test('segments in seconds and bare frame rows remain supported', () => {
  assert.equal(captionsToSrt({ segments: [{ text: 'segment', start: 1, end: 2 }] }, 30),
    '1\n00:00:01,000 --> 00:00:02,000\nsegment\n');
  assert.equal(captionsToSrt([{ text: '短句', from: 30, to: 60 }], 30),
    '1\n00:00:01,000 --> 00:00:02,000\n短句\n');
});

test('EP01 display captions export corrected semantic phrases, not retained raw ASR', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../../projects/EP01-TechPhilosophy-Act1-v2/assets/captions-display.json', import.meta.url), 'utf8'));
  assert.ok(data.words.length > data.captions.length);
  const cues = blocks(captionsToSrt(data, 30));
  assert.deepEqual(cues.map((cue) => cue[2]), data.captions.map((row) => row.text));
  assert.equal(cues[0][1], '00:00:01,550 --> 00:00:03,630');
  assert.equal(cues[0][2], 'AI 要取代人类了！');
});
