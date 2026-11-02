/**
 * Linvis visual primitives.
 * 只用确定性数学：同一帧号永远得到同一像素，保证可复现渲染。
 */
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing, spring } from 'remotion';

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** progress 0..1 across a window of frames, eased. */
export const useProgress = (start: number, len: number, easing = Easing.out(Easing.cubic)) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + Math.max(1, len)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
  return p;
};

/** Frames elapsed since a start frame (can be negative). */
export const useElapsed = (start: number) => useCurrentFrame() - start;

/** Deterministic pseudo-random in [0,1) from integer seed. */
export const hash01 = (n: number) => {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  x = x - Math.floor(x);
  return x;
};

/** Deterministic signed jitter in [-1,1], sampled at `fps`-independent rate. */
export const jitter = (frame: number, seed: number, amp = 1) =>
  (hash01(frame * 7 + seed * 1013) * 2 - 1) * amp;

export const FilmGrain: React.FC<{ opacity?: number; seed?: number }> = ({ opacity = 0.055, seed = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // 12 fps grain refresh = 胶片颗粒感，同时降低编码负担
  const tick = Math.floor(frame / 2.5);
  const blobs = 46;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity, mixBlendMode: 'overlay', pointerEvents: 'none', overflow: 'hidden' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {Array.from({ length: blobs }).map((_, i) => {
          const x = hash01(tick * 31 + i * 7 + seed) * width;
          const y = hash01(tick * 17 + i * 13 + seed * 3) * height;
          const r = 8 + hash01(tick * 11 + i * 5 + seed * 7) * 70;
          const o = 0.25 + hash01(tick * 23 + i * 3) * 0.6;
          return <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={o} />;
        })}
      </svg>
    </div>
  );
};

/** Subtle vertical scanlines + vignette — dark tech look. */
export const ScanlinesVignette: React.FC<{ vignette?: number }> = ({ vignette = 0.72 }) => {
  const { width, height } = useVideoConfig();
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 4px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 34%, rgba(0,0,0,${vignette}) 100%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(circle at 50% 42%, rgba(0,240,255,0.05) 0%, rgba(0,0,0,0) 58%)`,
          pointerEvents: 'none',
        }}
      />
    </>
  );
};

/** Chromatic-aberration text: three offset copies. */
export const ChromaText: React.FC<{
  text: string;
  size: number;
  weight?: number;
  family?: string;
  spread?: number;
  color?: string;
  glow?: number;
  letterSpacing?: number;
  style?: React.CSSProperties;
}> = ({ text, size, weight = 900, family, spread = 0, color = '#ffffff', glow = 0, letterSpacing = 0, style }) => {
  return (
    <div style={{ position: 'relative', ...style }}>
      {spread > 0.2 && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              color: '#00e5ff',
              transform: `translateX(${-spread}px)`,
              opacity: 0.85,
              mixBlendMode: 'screen',
              fontFamily: family,
              fontSize: size,
              fontWeight: weight,
              letterSpacing,
              lineHeight: 1,
            }}
            aria-hidden
          >
            {text}
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              color: '#ff0044',
              transform: `translateX(${spread}px)`,
              opacity: 0.8,
              mixBlendMode: 'screen',
              fontFamily: family,
              fontSize: size,
              fontWeight: weight,
              letterSpacing,
              lineHeight: 1,
            }}
            aria-hidden
          >
            {text}
          </div>
        </>
      )}
      <div
        style={{
          position: 'relative',
          color,
          fontFamily: family,
          fontSize: size,
          fontWeight: weight,
          letterSpacing,
          lineHeight: 1,
          textShadow: glow ? `0 0 ${glow}px rgba(0,229,255,0.55), 0 0 ${glow * 2.6}px rgba(0,150,255,0.28)` : undefined,
        }}
      >
        {text}
      </div>
    </div>
  );
};

/* ---------------- 文本几何：字宽估算 / 自动折行 / 自动适配 ---------------- */

/** 估算单个字符占 fontSize 的宽度比例（不依赖 DOM 测量，确定性）。 */
export const charRatio = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0;
  if (ch === ' ') return 0.28;
  // CJK 统一表意文字 / 全角标点 / 假名 / 韩文
  if (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x3000 && c <= 0x303f) ||
    (c >= 0xff00 && c <= 0xffef) ||
    (c >= 0x3040 && c <= 0x30ff) ||
    (c >= 0xac00 && c <= 0xd7af)
  ) return 1.0;
  if (c >= 0x41 && c <= 0x5a) return 0.66; // A-Z
  if (c >= 0x30 && c <= 0x39) return 0.58; // 0-9
  if (c >= 0x61 && c <= 0x7a) return 0.54; // a-z
  return 0.52;
};

export const measureText = (text: string, size: number, letterSpacing = 0): number => {
  let w = 0;
  for (const ch of text) w += charRatio(ch) * size;
  return w + Math.max(0, Array.from(text).length - 1) * letterSpacing;
};

/** 按最大宽度把文本折成多行（尊重已有换行符）。 */
export const wrapText = (text: string, size: number, maxWidth: number, letterSpacing = 0): string[] => {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.length) { out.push(''); continue; }
    let line = '';
    for (const ch of paragraph) {
      const next = line + ch;
      if (line && measureText(next, size, letterSpacing) > maxWidth) {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
};

/**
 * 自动适配字号：在给定宽高盒子里找到能放下全部文字的最大字号。
 * 从 maxSize 逐级缩小，优先保证不溢出，其次保证行长均衡。
 */
export const autoFit = (
  text: string,
  opts: { maxWidth: number; maxHeight: number; maxSize: number; minSize?: number; lineHeight?: number; letterSpacing?: number },
): { size: number; lines: string[] } => {
  const { maxWidth, maxHeight, maxSize, minSize = 40, lineHeight = 1.16, letterSpacing = 0 } = opts;
  let size = maxSize;
  let lines = wrapText(text, size, maxWidth, letterSpacing);

  while (size > minSize) {
    lines = wrapText(text, size, maxWidth, letterSpacing);
    const totalH = lines.length * size * lineHeight;
    const widest = Math.max(...lines.map((l) => measureText(l, size, letterSpacing)));
    if (totalH <= maxHeight && widest <= maxWidth) break;
    size = Math.max(minSize, Math.round(size * 0.94));
  }
  return { size, lines };
};

/** 多行彩色文字主体（带色散与发光），保证永不溢出画布。 */
export const FittedText: React.FC<{
  text: string;
  maxWidth: number;
  maxHeight: number;
  maxSize: number;
  minSize?: number;
  weight?: number;
  family?: string;
  color?: string;
  glow?: number;
  spread?: number;
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  style?: React.CSSProperties;
}> = ({
  text, maxWidth, maxHeight, maxSize, minSize, weight = 900, family, color = '#fff',
  glow = 0, spread = 0, letterSpacing = 0, align = 'center', lineHeight = 1.16, style,
}) => {
  const { size, lines } = autoFit(text, { maxWidth, maxHeight, maxSize, minSize, lineHeight, letterSpacing });
  const alignCss = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start', ...style }}>
      {lines.map((line, i) => (
        <div key={i} style={{ position: 'relative' }}>
          {spread > 0.2 && (
            <>
              <div aria-hidden style={{
                position: 'absolute', inset: 0, color: '#00e5ff', transform: `translateX(${-spread}px)`,
                opacity: 0.85, mixBlendMode: 'screen', fontFamily: family, fontSize: size,
                fontWeight: weight, letterSpacing, lineHeight, whiteSpace: 'pre', textAlign: alignCss,
              }}>{line}</div>
              <div aria-hidden style={{
                position: 'absolute', inset: 0, color: '#ff0044', transform: `translateX(${spread}px)`,
                opacity: 0.8, mixBlendMode: 'screen', fontFamily: family, fontSize: size,
                fontWeight: weight, letterSpacing, lineHeight, whiteSpace: 'pre', textAlign: alignCss,
              }}>{line}</div>
            </>
          )}
          <div style={{
            position: 'relative', color, fontFamily: family, fontSize: size, fontWeight: weight,
            letterSpacing, lineHeight, whiteSpace: 'pre', textAlign: alignCss,
            textShadow: glow ? `0 0 ${glow}px rgba(0,229,255,0.55), 0 0 ${glow * 2.6}px rgba(0,150,255,0.28)` : undefined,
          }}>{line}</div>
        </div>
      ))}
    </div>
  );
};

/** A thin expanding rule, used as a reveal device. */
export const HairLine: React.FC<{ width: number; progress: number; color?: string; thickness?: number }> = ({
  width,
  progress,
  color = 'rgba(0,229,255,0.9)',
  thickness = 2,
}) => (
  <div
    style={{
      width: width * clamp01(progress),
      height: thickness,
      background: color,
      boxShadow: `0 0 18px ${color}`,
    }}
  />
);
