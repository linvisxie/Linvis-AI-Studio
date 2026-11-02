/**
 * Programmatic audio synthesis — zero third-party rights.
 *
 * All music/SFX used by Linvis samples are generated from deterministic math
 * defined in assets/recipes/*.json. Same recipe + same seed => same WAV bytes.
 * Output: 48 kHz, 16-bit stereo PCM WAV.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SR = 48000;

/* ---------- deterministic PRNG (mulberry32) ---------- */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- WAV writing ---------- */
export function writeWav(file, channelsFloat, sampleRate = SR) {
  const numCh = channelsFloat.length;
  const frames = channelsFloat[0].length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);              // PCM
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      let v = channelsFloat[c][i];
      // soft clip then hard clamp
      v = Math.tanh(v * 1.05);
      v = Math.max(-1, Math.min(1, v));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return { file, frames, sampleRate, channels: numCh, durationSec: frames / sampleRate, bytes: buf.length };
}

export function buffer(durationSec, channels = 2) {
  const n = Math.max(1, Math.round(durationSec * SR));
  const ch = [];
  for (let c = 0; c < channels; c++) ch.push(new Float32Array(n));
  return { ch, n, sr: SR };
}

/* ---------- primitive envelopes ---------- */
export const env = {
  /** exponential decay: peak at t=0, decays with rate (per second) */
  decay: (t, rate = 6) => Math.exp(-rate * t),
  /** linear attack then sustain */
  attack: (t, a = 0.005) => (t < a ? t / a : 1),
  /** smooth release over last r seconds of dur */
  release: (t, dur, r = 0.05) => {
    const left = dur - t;
    return left < r ? Math.max(0, left / r) : 1;
  },
  /** attack-decay-sustain-release shape 0..1 given normalized time 0..1 */
  adsr: (p, a = 0.01, d = 0.1, s = 0.7, r = 0.2) => {
    if (p < a) return p / a;
    if (p < a + d) return 1 - (1 - s) * ((p - a) / d);
    if (p < 1 - r) return s;
    return s * Math.max(0, (1 - p) / r);
  },
  /** exponential fade out over [start,1] in normalized time */
  fadeTail: (p, start = 0.9) => (p < start ? 1 : Math.max(0, (1 - p) / (1 - start))),
};

/* ---------- oscillators ---------- */
export const osc = {
  sine: (phase) => Math.sin(phase * Math.PI * 2),
  saw: (phase) => 2 * (phase - Math.floor(phase + 0.5)),
  square: (phase) => (phase % 1 < 0.5 ? 1 : -1),
  tri: (phase) => {
    const p = phase % 1;
    return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  },
  noise: (rng) => rng() * 2 - 1,
};

/* ---------- one-pole filters ---------- */
export class OnePole {
  constructor(cutoffHz, sr = SR) { this.setCutoff(cutoffHz, sr); this.z = 0; }
  setCutoff(hz, sr = SR) {
    this.a = Math.exp((-2 * Math.PI * Math.max(1, hz)) / sr);
    return this;
  }
  lp(x) { this.z = (1 - this.a) * x + this.a * this.z; return this.z; }
  hp(x) { this.z = (1 - this.a) * x + this.a * this.z; return x - this.z; }
}

/* ================= LAYER GENERATORS ================= */
/**
 * Each generator returns { ch:[Float32Array, Float32Array], sr }
 * and must be fully deterministic given (spec, seed).
 */
export const generators = {
  /**
   * Deep cinematic impact: sub sine drop + body thump + noise transient + tail.
   */
  impact(spec) {
    const {
      durationSec = 1.6,
      startHz = 110,
      endHz = 34,
      decay = 4.2,
      bodyGain = 0.55,
      subGain = 1.0,
      transientGain = 0.5,
      tailGain = 0.32,
      tailDecay = 2.6,
      distortion = 1.0,
      seed = 7,
      stereo = 0.12,
    } = spec;
    const b = buffer(durationSec, 2);
    const rng = makeRng(seed);
    const lpL = new OnePole(900);
    const lpR = new OnePole(900);
    let phase = 0;
    for (let i = 0; i < b.n; i++) {
      const t = i / SR;
      const p = t / durationSec;
      // pitch sweep (exponential glide)
      const f = endHz + (startHz - endHz) * Math.exp(-t * 7.5);
      phase += f / SR;
      const e = env.decay(t, decay);
      const sub = osc.sine(phase) * e * subGain;
      // body: filtered noise burst, low
      const nz = osc.noise(rng);
      const body = lpL.lp(nz) * env.decay(t, decay * 2.4) * bodyGain * 2.2;
      const bodyR = lpR.lp(osc.noise(rng)) * env.decay(t, decay * 2.4) * bodyGain * 2.2;
      // transient click
      const trans = nz * env.decay(t, 90) * transientGain;
      // metallic tail
      const tail = (osc.sine(phase * 3.01) * 0.5 + osc.sine(phase * 5.4) * 0.25) *
        env.decay(t, tailDecay) * tailGain * 0.5;

      let l = sub + body + trans + tail;
      let r = sub + bodyR + trans + tail * 0.9;
      // mild saturation for weight
      if (distortion !== 1) { l = Math.tanh(l * distortion * 1.6); r = Math.tanh(r * distortion * 1.6); }
      // stereo widening on the low tail only
      const w = stereo * Math.min(1, p * 3);
      const mid = (l + r) * 0.5;
      l = mid + (l - mid) * (1 + w);
      r = mid + (r - mid) * (1 + w);
      b.ch[0][i] += l;
      b.ch[1][i] += r;
    }
    return b;
  },

  /** Rising tension sweep (noise + pitch ramp), used before a drop. */
  riser(spec) {
    const {
      durationSec = 2.4,
      fromHz = 120,
      toHz = 2400,
      gain = 0.30,
      seed = 21,
      shape = 2.2,
    } = spec;
    const b = buffer(durationSec, 2);
    const rng = makeRng(seed);
    const bpL = new OnePole(400);
    const bpR = new OnePole(400);
    let phase = 0;
    for (let i = 0; i < b.n; i++) {
      const t = i / SR;
      const p = t / durationSec;
      const f = fromHz * Math.pow(toHz / fromHz, Math.pow(p, 0.7));
      phase += f / SR;
      bpL.setCutoff(f * 1.4);
      bpR.setCutoff(f * 1.55);
      const e = Math.pow(p, shape) * env.release(t, durationSec, 0.08);
      const nz = osc.noise(rng);
      const tone = osc.sine(phase) * 0.35;
      const n = bpL.hp(nz) * 0.8;
      const nr = bpR.hp(osc.noise(rng)) * 0.8;
      b.ch[0][i] += (tone + n) * e * gain;
      b.ch[1][i] += (tone + nr) * e * gain;
    }
    return b;
  },

  /** Dark drone pad: detuned low saws + slow filter movement. */
  drone(spec) {
    const {
      durationSec = 6,
      rootHz = 55,
      intervals = [1, 1.5, 2, 2.996],
      gain = 0.18,
      seed = 33,
      cutoff = 420,
      wobbleHz = 0.11,
    } = spec;
    const b = buffer(durationSec, 2);
    const rng = makeRng(seed);
    const voices = intervals.map((iv, k) => ({
      f: rootHz * iv * (1 + (k % 2 ? 0.0025 : -0.0025)),
      det: 0.0015 * (k + 1),
      ph: 0,
      pan: k / Math.max(1, intervals.length - 1),
    }));
    const lpL = new OnePole(cutoff);
    const lpR = new OnePole(cutoff * 1.12);
    for (let i = 0; i < b.n; i++) {
      const t = i / SR;
      const p = t / durationSec;
      const cut = cutoff * (1 + 0.5 * Math.sin(2 * Math.PI * wobbleHz * t));
      lpL.setCutoff(cut);
      lpR.setCutoff(cut * 1.1);
      let l = 0, r = 0;
      for (const v of voices) {
        v.ph += (v.f * (1 + v.det * Math.sin(2 * Math.PI * 0.37 * t))) / SR;
        const s = osc.saw(v.ph) * 0.5 + osc.saw(v.ph * 1.004) * 0.5;
        l += s * (1 - v.pan);
        r += s * v.pan;
      }
      const e = env.attack(t, 0.9) * env.release(t, durationSec, 0.8);
      b.ch[0][i] += lpL.lp(l / voices.length) * e * gain;
      b.ch[1][i] += lpR.lp(r / voices.length) * e * gain;
    }
    return b;
  },

  /** Glitchy digital ticks — good for tech UI visuals. */
  ticks(spec) {
    const {
      durationSec = 4,
      rate = 9,
      gain = 0.12,
      seed = 55,
      brightHz = 3400,
    } = spec;
    const b = buffer(durationSec, 2);
    const rng = makeRng(seed);
    const count = Math.floor(durationSec * rate);
    for (let k = 0; k < count; k++) {
      const at = (k / rate) * (0.85 + rng() * 0.3);
      const startIdx = Math.floor(at * SR);
      const len = Math.floor(SR * (0.008 + rng() * 0.02));
      const f = brightHz * (0.6 + rng() * 0.9);
      const pan = rng();
      let ph = 0;
      for (let j = 0; j < len && startIdx + j < b.n; j++) {
        const t = j / SR;
        ph += f / SR;
        const s = (osc.square(ph) * 0.35 + osc.sine(ph * 2.7) * 0.4) * env.decay(t, 220) * gain;
        b.ch[0][startIdx + j] += s * (1 - pan);
        b.ch[1][startIdx + j] += s * pan;
      }
    }
    return b;
  },

  /** Heartbeat-like double thump for tension pacing. */
  pulse(spec) {
    const { durationSec = 4, bpm = 62, gain = 0.34, rootHz = 62, seed = 71 } = spec;
    const b = buffer(durationSec, 2);
    const beat = 60 / bpm;
    const hits = [];
    for (let t = 0.15; t < durationSec - 0.2; t += beat) hits.push(t, t + beat * 0.26);
    for (const at of hits) {
      const startIdx = Math.floor(at * SR);
      const len = Math.floor(SR * 0.42);
      let ph = 0;
      const rng = makeRng(seed + Math.floor(at * 100));
      const lp = new OnePole(260);
      for (let j = 0; j < len && startIdx + j < b.n; j++) {
        const t = j / SR;
        const f = rootHz * (1 + 0.6 * Math.exp(-t * 22));
        ph += f / SR;
        const e = env.decay(t, 8.5);
        const s = (osc.sine(ph) + lp.lp(osc.noise(rng)) * 0.5) * e * gain;
        b.ch[0][startIdx + j] += s;
        b.ch[1][startIdx + j] += s * 0.98;
      }
    }
    return b;
  },

  /** Reverse cymbal-ish swell (noise with rising amplitude). */
  swell(spec) {
    const { durationSec = 2.0, gain = 0.22, seed = 91, hpHz = 2400 } = spec;
    const b = buffer(durationSec, 2);
    const rng = makeRng(seed);
    const f1 = new OnePole(hpHz);
    const f2 = new OnePole(hpHz * 1.1);
    for (let i = 0; i < b.n; i++) {
      const t = i / SR;
      const p = t / durationSec;
      const e = Math.pow(p, 1.6) * env.release(t, durationSec, 0.03);
      b.ch[0][i] += f1.hp(osc.noise(rng)) * e * gain;
      b.ch[1][i] += f2.hp(osc.noise(rng)) * e * gain * 0.95;
    }
    return b;
  },

  /** Pure silence, for scripting a hard stop. */
  silence(spec) {
    const { durationSec = 0.6 } = spec;
    return buffer(durationSec, 2);
  },
};

/* ================= MIXING ================= */
/**
 * Mix layers into a master timeline.
 * layers: [{ gen:'impact', at:0, gain:1, spec:{...} }]
 */
export function mixLayers(layers, totalDurationSec, opts = {}) {
  const { masterGain = 1.0 } = opts;
  const b = buffer(totalDurationSec, 2);
  const detail = [];

  for (const layer of layers) {
    const fn = generators[layer.gen];
    if (!fn) throw new Error(`未知音频生成器: ${layer.gen}`);
    const src = fn(layer.spec || {});
    const start = Math.max(0, Math.round((layer.at || 0) * SR));
    const g = layer.gain ?? 1;
    for (let c = 0; c < 2; c++) {
      const dst = b.ch[c];
      const s = src.ch[c];
      for (let i = 0; i < s.length && start + i < dst.length; i++) {
        dst[start + i] += s[i] * g;
      }
    }
    detail.push({ gen: layer.gen, at: layer.at || 0, gain: g, durationSec: src.n / SR });
  }

  for (let c = 0; c < 2; c++) {
    const d = b.ch[c];
    for (let i = 0; i < d.length; i++) d[i] *= masterGain;
  }
  return { buffer: b, detail };
}

/** Peak-normalize to a target peak (linear, e.g. 0.89 ≈ -1 dBFS). */
export function normalize(b, targetPeak = 0.89) {
  let peak = 0;
  for (const ch of b.ch) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak === 0) return { peak: 0, applied: 1 };
  const g = targetPeak / peak;
  for (const ch of b.ch) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return { peak, applied: g };
}

/** Apply a 20ms fade in/out on the master to avoid clicks. */
export function deClick(b, ms = 20) {
  const n = Math.round((ms / 1000) * SR);
  for (const ch of b.ch) {
    for (let i = 0; i < n && i < ch.length; i++) {
      const g = i / n;
      ch[i] *= g;
      ch[ch.length - 1 - i] *= g;
    }
  }
  return b;
}

/** Render a recipe object (from assets/recipes/*.json) to a WAV file. */
export function renderRecipe(recipe, outFile) {
  const { durationSec, masterGain = 1, peak = 0.89, deClickMs = 20, layers } = recipe;
  if (!Array.isArray(layers)) throw new Error('recipe.layers 必须为数组');
  const { buffer: mixed, detail } = mixLayers(layers, durationSec, { masterGain });
  const applied = normalize(mixed, peak);
  deClick(mixed, deClickMs);
  const wrote = writeWav(outFile, mixed.ch, SR);
  return { ...wrote, normPeak: applied.peak, normGain: applied.applied, layers: detail };
}