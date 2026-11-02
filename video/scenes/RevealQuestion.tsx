import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { ChromaText, FittedText, FilmGrain, ScanlinesVignette } from '../components/primitives';

export type RevealQuestionProps = {
  /** 主问句 */
  question: string;
  /** 问句下方的小字，可以是多行 */
  sublines?: string[];
  /** 顶部小标签 */
  kicker?: string;
  fontSize?: number;
  accent?: string;
  accentAlt?: string;
  ink?: string;
  fontFamily?: string;
};

/**
 * 反问揭示镜头：撞击后的「真空」，缓慢、克制、几乎无声。
 * 动画：先一根细线横向扩张 → 文字自下而上淡入 → 问号延迟出现。
 */
export const RevealQuestion: React.FC<RevealQuestionProps> = ({
  question,
  sublines = [],
  kicker,
  fontSize = 96,
  accent = '#00e5ff',
  accentAlt = '#ff0044',
  ink = '#e8eef2',
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // 细线扩张 0..18 帧
  const lineP = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // 主问句淡入并轻微上浮
  const qP = interpolate(frame, [10, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const qY = interpolate(qP, [0, 1], [34, 0]);

  // 小字逐条出现
  const subOpacity = (i: number) =>
    interpolate(frame, [38 + i * 12, 54 + i * 12], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  // 缓慢推近，制造压迫感
  const push = interpolate(frame, [0, 300], [1, 1.055], { extrapolateRight: 'clamp' });

  // 极轻的呼吸
  const breath = 1 + 0.0035 * Math.sin((frame / fps) * Math.PI * 0.85);

  return (
    <AbsoluteFill style={{ backgroundColor: '#04050a', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at 50% 52%, rgba(0,70,120,0.20) 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, #04050a 0%, #070a10 50%, #04050a 100%)',
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          transform: `scale(${push * breath})`,
          padding: '0 96px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: 34 }}>
          {/* 细线 */}
          <div
            style={{
              width: (width - 192) * lineP,
              height: 1,
              background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
              opacity: 0.85,
            }}
          />

          {kicker && (
            <div
              style={{
                fontFamily,
                fontSize: 28,
                letterSpacing: 12,
                color: accent,
                opacity: qP * 0.9,
              }}
            >
              {kicker}
            </div>
          )}

          <FittedText
            text={question}
            maxWidth={width - 192}
            maxHeight={Math.round(height * 0.22)}
            maxSize={fontSize}
            minSize={Math.round(fontSize * 0.55)}
            weight={800}
            family={fontFamily}
            spread={0}
            color={ink}
            glow={16}
            letterSpacing={4}
            lineHeight={1.22}
            style={{
              opacity: qP,
              transform: `translateY(${qY}px)`,
              textAlign: 'center',
            }}
          />

          {/* 问号强调 */}
          <div
            style={{
              fontFamily,
              fontSize: fontSize * 0.95,
              fontWeight: 900,
              color: accentAlt,
              opacity: interpolate(frame, [26, 44], [0, 0.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              marginTop: -fontSize * 0.72,
              marginLeft: fontSize * 0.2,
              textShadow: `0 0 30px ${accentAlt}`,
            }}
          >
            ？
          </div>

          <div
            style={{
              width: (width - 192) * lineP,
              height: 1,
              background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)`,
            }}
          />

          {sublines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 18 }}>
              {sublines.map((s, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily,
                    fontSize: 40,
                    letterSpacing: 3,
                    color: 'rgba(230,238,242,0.66)',
                    opacity: subOpacity(i),
                    textAlign: 'center',
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      </AbsoluteFill>

      <ScanlinesVignette vignette={0.86} />
      <FilmGrain opacity={0.045} seed={9} />
    </AbsoluteFill>
  );
};
