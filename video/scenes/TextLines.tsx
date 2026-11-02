import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing, spring } from 'remotion';
import { FilmGrain, ScanlinesVignette } from '../components/primitives';

export type TextLinesProps = {
  lines: Array<{ text: string; size?: number; color?: string; weight?: number }>;
  /** 每行起始帧间隔 */
  stagger?: number;
  /** 是否逐字显现 */
  perChar?: boolean;
  align?: 'left' | 'center' | 'right';
  accent?: string;
  fontFamily?: string;
  /** 高亮某一行（0-based） */
  highlightLine?: number;
};

/** 文字逐行 / 逐字动画。 */
export const TextLines: React.FC<TextLinesProps> = ({
  lines,
  stagger = 14,
  perChar = false,
  align = 'left',
  accent = '#00e5ff',
  fontFamily,
  highlightLine,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: '#05060a', padding: '0 92px', justifyContent: 'center' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 30% 40%, rgba(0,90,140,0.16) 0%, rgba(0,0,0,0) 60%)',
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 30,
          alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        {lines.map((ln, i) => {
          const start = i * stagger;
          const p = interpolate(frame, [start, start + 22], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic),
          });
          const size = ln.size ?? 68;
          const isHi = highlightLine === i;

          if (perChar) {
            const chars = Array.from(ln.text);
            return (
              <div key={i} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
                {chars.map((c, k) => {
                  const cp = interpolate(frame, [start + k * 2, start + k * 2 + 12], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  });
                  return (
                    <span
                      key={k}
                      style={{
                        fontFamily,
                        fontSize: size,
                        fontWeight: ln.weight ?? 800,
                        color: ln.color ?? (isHi ? accent : '#f2f6f8'),
                        opacity: cp,
                        transform: `translateY(${(1 - cp) * 22}px)`,
                        display: 'inline-block',
                        textShadow: isHi ? `0 0 28px ${accent}66` : undefined,
                      }}
                    >
                      {c}
                    </span>
                  );
                })}
              </div>
            );
          }

          return (
            <div
              key={i}
              style={{
                fontFamily,
                fontSize: size,
                fontWeight: ln.weight ?? 800,
                color: ln.color ?? (isHi ? accent : '#f2f6f8'),
                opacity: p,
                transform: `translateY(${(1 - p) * 30}px)`,
                lineHeight: 1.24,
                textAlign: align,
                textShadow: isHi ? `0 0 34px ${accent}55` : '0 2px 24px rgba(0,0,0,0.7)',
              }}
            >
              {ln.text}
            </div>
          );
        })}
      </div>
      <ScanlinesVignette vignette={0.8} />
      <FilmGrain opacity={0.05} seed={17} />
    </AbsoluteFill>
  );
};
