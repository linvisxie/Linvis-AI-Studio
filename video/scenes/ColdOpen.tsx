import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { FilmGrain, ScanlinesVignette, clamp01, hash01 } from '../components/primitives';

export type ColdOpenProps = {
  /** 顶部 HUD 文本 */
  hud?: string;
  /** 中央极小的提示文本 */
  whisper?: string;
  accent?: string;
  accentAlt?: string;
  fontFamily?: string;
  /** 结束帧数（用于升压收束） */
  buildTo?: number;
};

/**
 * 冷开场：黑暗科技感 + 逐渐收紧的张力。
 * 时间轴上做「HUD 上线 → 扫描线扫过 → 频率锁定 → 闪断」四拍，
 * 最后一帧直接交给 impact-title 的撞击。
 */
export const ColdOpen: React.FC<ColdOpenProps> = ({
  hud = 'SYSTEM // ONLINE',
  whisper,
  accent = '#00e5ff',
  accentAlt = '#ff0044',
  fontFamily,
  buildTo,
}) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const total = buildTo ?? durationInFrames;
  const p = clamp01(frame / Math.max(1, total));

  const cx = width / 2;
  const cy = height / 2;

  // HUD 上线
  const hudP = interpolate(frame, [2, 14], [0, 1], { extrapolateRight: 'clamp' });
  // 扫描线自下而上
  const scanY = interpolate(p, [0, 1], [height * 0.86, height * 0.16]);
  const scanO = interpolate(p, [0, 0.15, 0.85, 1], [0, 0.55, 0.55, 0], { extrapolateRight: 'clamp' });
  // 同心环收紧（半径随进度收缩 = 压迫感）
  const ringBase = Math.min(width, height) * 0.44;
  const ringTighten = interpolate(p, [0, 1], [1, 0.62], { extrapolateRight: 'clamp' });
  // 刻度环旋转
  const tickRot = frame * 1.4;
  // 尾部闪断
  const flicker = p > 0.9 ? (hash01(frame * 3) > 0.35 ? 1 : 0.15) : 1;
  // 中心点亮度随进度提升
  const coreGlow = interpolate(p, [0, 1], [0.25, 1]);
  // 极轻的横向抖动，随进度增强
  const shake = interpolate(p, [0.6, 1], [0, 3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const sx = (hash01(frame * 13) * 2 - 1) * shake;
  const sy = (hash01(frame * 29) * 2 - 1) * shake;

  const ticks = 60;

  return (
    <AbsoluteFill style={{ backgroundColor: '#04050a', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, rgba(0,90,140,${0.08 + coreGlow * 0.14}) 0%, rgba(0,0,0,0) 56%)`,
        }}
      />

      <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px)` }}>
        <svg width={width} height={height}>
          {/* 同心环 */}
          {[1, 0.82, 0.66, 0.5].map((k, i) => {
            const r = ringBase * k * ringTighten;
            const o = (0.30 - i * 0.055) * (0.4 + p * 0.9) * flicker;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={i === 3 ? accentAlt : accent}
                strokeOpacity={Math.max(0.02, o)}
                strokeWidth={i === 0 ? 1.6 : 1}
                strokeDasharray={i % 2 === 0 ? '4 18' : undefined}
                transform={`rotate(${i % 2 === 0 ? tickRot : -tickRot * 0.6} ${cx} ${cy})`}
              />
            );
          })}

          {/* 刻度 */}
          <g transform={`rotate(${tickRot * 0.4} ${cx} ${cy})`} opacity={0.5 * (0.3 + p * 0.8)}>
            {Array.from({ length: ticks }).map((_, i) => {
              const a = (i / ticks) * Math.PI * 2;
              const r1 = ringBase * ringTighten * 1.02;
              const len = i % 5 === 0 ? 16 : 7;
              const r2 = r1 + len;
              return (
                <line
                  key={i}
                  x1={cx + Math.cos(a) * r1}
                  y1={cy + Math.sin(a) * r1}
                  x2={cx + Math.cos(a) * r2}
                  y2={cy + Math.sin(a) * r2}
                  stroke={i % 10 === 0 ? accentAlt : accent}
                  strokeOpacity={i % 5 === 0 ? 0.55 : 0.22}
                  strokeWidth={i % 5 === 0 ? 1.6 : 1}
                />
              );
            })}
          </g>

          {/* 十字准线 */}
          <g opacity={0.35 * coreGlow}>
            <line x1={cx - 46} y1={cy} x2={cx + 46} y2={cy} stroke={accent} strokeWidth={1} opacity={0.5} />
            <line x1={cx} y1={cy - 46} x2={cx} y2={cy + 46} stroke={accent} strokeWidth={1} opacity={0.5} />
          </g>

          {/* 中心脉冲点 */}
          <circle cx={cx} cy={cy} r={3 + coreGlow * 4} fill={accent} opacity={0.75 * coreGlow * flicker} />
        </svg>

        {/* 扫描线 */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: scanY,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            opacity: scanO,
            boxShadow: `0 0 26px ${accent}`,
          }}
        />

        {/* HUD 文本 */}
        <div
          style={{
            position: 'absolute',
            top: 150,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily,
            fontSize: 24,
            letterSpacing: 12,
            color: accent,
            opacity: hudP * 0.8 * flicker,
          }}
        >
          {hud}
        </div>

        {whisper && (
          <div
            style={{
              position: 'absolute',
              bottom: 190,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontFamily,
              fontSize: 26,
              letterSpacing: 6,
              color: 'rgba(230,238,242,0.42)',
              opacity: interpolate(frame, [Math.round(total * 0.45), Math.round(total * 0.8)], [0, 0.9], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
            }}
          >
            {whisper}
          </div>
        )}
      </AbsoluteFill>

      <ScanlinesVignette vignette={0.86} />
      <FilmGrain opacity={0.05} seed={3} />
    </AbsoluteFill>
  );
};
