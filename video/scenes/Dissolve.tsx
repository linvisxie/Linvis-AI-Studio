import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { FittedText, FilmGrain, ScanlinesVignette, clamp01, hash01 } from '../components/primitives';

export type DissolveProps = {
  /** 闪现的短语序列，逐条快速切换（预告片式"信息轰炸"） */
  flashes: string[];
  /** 最后一条停留的句子 */
  finalLine?: string;
  accent?: string;
  accentAlt?: string;
  fontFamily?: string;
};

/**
 * 问题扩散镜头：快切短句 → 逐渐减速 → 收束到一句问话。
 * 用来给反问段落制造节奏，避免长时间静止。
 */
export const Dissolve: React.FC<DissolveProps> = ({
  flashes,
  finalLine,
  accent = '#00e5ff',
  accentAlt = '#ff0044',
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const p = clamp01(frame / Math.max(1, durationInFrames - 1));

  // 快切：前 62% 时间均匀放完所有 flashes（线性均分，每项都有停留时间）
  const n = Math.max(1, flashes.length);
  const cutEnd = 0.62;
  const slot = cutEnd / n;
  const rawIdx = Math.floor(p / slot);
  const idx = Math.min(n - 1, Math.max(0, rawIdx));
  const localP = clamp01((p - idx * slot) / slot); // 0..1 在当前条目内
  const showingFinal = p > cutEnd && !!finalLine;

  // 每项内部：快速淡入 → 稳定 → 尾部快速淡出，相邻项交叉，不留黑屏
  const fade = p < cutEnd
    ? interpolate(localP, [0, 0.1, 0.88, 1], [0.15, 1, 1, 0.15], { extrapolateRight: 'clamp' })
    : 1;
  const jolt = p < cutEnd ? (hash01(frame * 7) > 0.7 ? -18 : 0) : 0;
  const scalePulse = p < cutEnd ? 1 + (1 - localP) * 0.05 : 1;

  const finalP = interpolate(p, [cutEnd, Math.min(1, cutEnd + 0.18)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // 背景随节奏闪烁
  const bgPulse = p < cutEnd ? 0.5 + 0.5 * Math.sin(frame * 1.9) : 0.25;

  return (
    <AbsoluteFill style={{ backgroundColor: '#050710', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 50%, rgba(0,100,150,${0.06 + bgPulse * 0.10}) 0%, rgba(0,0,0,0) 60%)`,
        }}
      />

      {/* 干扰网格 */}
      <AbsoluteFill style={{ opacity: 0.5 }}>
        <svg width={width} height={height}>
          {Array.from({ length: 9 }).map((_, i) => (
            <line key={`h${i}`} x1={0} y1={(height / 8) * i} x2={width} y2={(height / 8) * i} stroke={accent} strokeOpacity={0.05} strokeWidth={1} />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={`v${i}`} x1={(width / 4) * i} y1={0} x2={(width / 4) * i} y2={height} stroke={accent} strokeOpacity={0.05} strokeWidth={1} />
          ))}
        </svg>
      </AbsoluteFill>

      {!showingFinal ? (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 96px' }}>
          <div style={{ transform: `translateX(${jolt}px) scale(${scalePulse})`, opacity: fade }}>
            <FittedText
              text={flashes[Math.min(idx, n - 1)] ?? ''}
              maxWidth={width - 192}
              maxHeight={height * 0.22}
              maxSize={92}
              minSize={48}
              family={fontFamily}
              color="#eaf4f8"
              glow={10}
              lineHeight={1.2}
            />
          </div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 96px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, opacity: finalP }}>
            <div style={{ width: (width - 260) * finalP, height: 1, background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
            <FittedText
              text={finalLine ?? ''}
              maxWidth={width - 192}
              maxHeight={height * 0.26}
              maxSize={96}
              minSize={52}
              weight={800}
              family={fontFamily}
              color="#ffffff"
              glow={18}
              letterSpacing={2}
              lineHeight={1.26}
            />
            <div style={{ width: (width - 260) * finalP, height: 1, background: `linear-gradient(90deg, transparent, ${accentAlt}88, transparent)` }} />
          </div>
        </AbsoluteFill>
      )}

      <ScanlinesVignette vignette={0.88} />
      <FilmGrain opacity={0.06} seed={31} />
    </AbsoluteFill>
  );
};
