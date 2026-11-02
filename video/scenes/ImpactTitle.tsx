import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing, spring } from 'remotion';
import { ChromaText, FittedText, FilmGrain, ScanlinesVignette, clamp01, jitter } from '../components/primitives';

export type ImpactTitleProps = {
  /** 主标题，逐字砸入 */
  text: string;
  /** 副标题 / 小字 */
  kicker?: string;
  /** 底部标签 */
  tag?: string;
  /** 撞击发生的相对帧（默认 0） */
  hitFrame?: number;
  fontSize?: number;
  accent?: string;
  accentAlt?: string;
  ink?: string;
  fontFamily?: string;
};

/**
 * 电影预告片式撞击标题。
 *
 * 时间轴（相对本镜头）：
 *  0 .. hitFrame-1 : 逐渐逼近的预热（暗、抖动、升压线）
 *  hitFrame        : 撞击 —— 主题字以 spring 砸入 + 色散 + 冲击波
 *  hitFrame+ ..    : 余震、扫描线、静默留白
 */
export const ImpactTitle: React.FC<ImpactTitleProps> = ({
  text,
  kicker,
  tag,
  hitFrame = 36,
  fontSize = 210,
  accent = '#00e5ff',
  accentAlt = '#ff0044',
  ink = '#ffffff',
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const hit = Math.max(1, hitFrame);
  const pre = clamp01(frame / hit);           // 0..1 撞击前
  const post = Math.max(0, frame - hit);      // 撞击后帧数

  // 砸入：spring 从 2.3x 缩到 1x（更快收束，避免超长溢出窗口）
  const slam = spring({
    frame: post,
    fps,
    config: { damping: 20, mass: 0.5, stiffness: 420 },
    durationInFrames: 12,
  });

  const scale = post < 0 ? 1.02 : interpolate(slam, [0, 1], [2.3, 1], { extrapolateRight: 'clamp' });
  // 砸入前 3 帧透明度爬升，把放大阶段的溢出藏起来
  const slamOpacity = post < 0 ? 1 : interpolate(post, [0, 1, 3], [0.25, 0.75, 1], { extrapolateRight: 'clamp' });
  const chroma = post < 0 ? 0 : interpolate(post, [0, 6, 18], [46, 14, 0], { extrapolateRight: 'clamp' });
  const glow = post < 0 ? 8 : interpolate(post, [0, 4, 22], [90, 44, 12], { extrapolateRight: 'clamp' });

  // 撞击瞬间的镜头抖动（指数衰减）
  const shakeAmp = post < 0 ? 2.2 * pre : 34 * Math.exp(-post / 5.2);
  const shakeX = jitter(frame, 3, shakeAmp);
  const shakeY = jitter(frame, 11, shakeAmp);

  // 预热：标题前的一根扫描线自下而上收紧
  const preLine = interpolate(pre, [0, 1], [height * 0.62, 0], { extrapolateRight: 'clamp' });

  // 冲击波环（撞击瞬间扩散）
  const shockT = post / 26;
  const shockR = interpolate(shockT, [0, 1], [40, width * 0.95], { extrapolateRight: 'clamp' });
  const shockO = post < 0 ? 0 : interpolate(shockT, [0, 0.25, 1], [0.85, 0.35, 0], { extrapolateRight: 'clamp' });

  // 白色闪光
  const flash = post < 0 ? 0 : interpolate(post, [0, 3, 12], [0.92, 0.30, 0], { extrapolateRight: 'clamp' });

  // 撞击后字幕稳定上浮
  const rise = post < 0 ? 0 : interpolate(post, [2, 22], [26, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const kickerOpacity = post < 0 ? 0 : interpolate(post, [4, 16], [0, 1], { extrapolateRight: 'clamp' });
  const tagOpacity = post < 0 ? 0 : interpolate(post, [14, 30], [0, 1], { extrapolateRight: 'clamp' });

  // 撞击后的持续低频呼吸抖动
  const breathe = 1 + 0.006 * Math.sin((frame / fps) * Math.PI * 1.6);

  const chars = Array.from(text);

  // 自动适配：保证主标题永不溢出画布（左右各留 72px）
  const fitWidth = width - 144;
  const fitHeight = Math.round(height * 0.34);

  return (
    <AbsoluteFill style={{ backgroundColor: '#050607', overflow: 'hidden' }}>
      {/* 底光 */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 45%, rgba(0,120,180,${0.10 + pre * 0.16}) 0%, rgba(0,0,0,0) 62%)`,
        }}
      />

      {/* 预热升压线 */}
      {frame < hit && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: height / 2 + preLine / 2,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            opacity: 0.5 + pre * 0.5,
            boxShadow: `0 0 24px ${accent}`,
          }}
        />
      )}

      {/* 冲击波 */}
      {shockO > 0 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: shockR * 2,
            height: shockR * 2,
            marginLeft: -shockR,
            marginTop: -shockR,
            borderRadius: '50%',
            border: `${Math.max(1, 6 * (1 - shockT))}px solid ${accent}`,
            opacity: shockO,
            boxShadow: `0 0 60px ${accent}`,
          }}
        />
      )}

      {/* 文字主体 */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          transform: `translate(${shakeX}px, ${shakeY}px) scale(${scale * breathe})`,
          opacity: slamOpacity,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
          {kicker && (
            <div
              style={{
                fontFamily: fontFamily,
                fontSize: 34,
                letterSpacing: 18,
                color: accent,
                opacity: kickerOpacity,
                textTransform: 'uppercase',
                transform: `translateY(${rise}px)`,
              }}
            >
              {kicker}
            </div>
          )}

          <FittedText
            text={text}
            maxWidth={fitWidth}
            maxHeight={fitHeight}
            maxSize={fontSize}
            minSize={Math.round(fontSize * 0.42)}
            family={fontFamily}
            spread={chroma}
            color={ink}
            glow={glow}
            letterSpacing={2}
            lineHeight={1.12}
            style={{ transform: `translateY(${rise}px)` }}
          />
          {tag && (
            <div
              style={{
                fontFamily: fontFamily,
                fontSize: 40,
                letterSpacing: 6,
                color: 'rgba(255,255,255,0.72)',
                opacity: tagOpacity,
                borderLeft: `3px solid ${accentAlt}`,
                paddingLeft: 18,
                transform: `translateY(${rise}px)`,
              }}
            >
              {tag}
            </div>
          )}
        </div>
      </AbsoluteFill>

      {/* 逐字残影：撞击后前 10 帧 */}
      {post >= 0 && post < 10 && (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: (1 - post / 10) * 0.42 }}>
          <div
            style={{
              fontFamily: fontFamily,
              fontSize: fontSize * (1 + post * 0.06),
              fontWeight: 900,
              color: accentAlt,
              filter: 'blur(6px)',
              mixBlendMode: 'screen',
            }}
          >
            {chars.join('')}
          </div>
        </AbsoluteFill>
      )}

      {/* 白闪 */}
      {flash > 0.001 && <AbsoluteFill style={{ backgroundColor: '#ffffff', opacity: flash }} />}

      <ScanlinesVignette vignette={0.78} />
      <FilmGrain opacity={0.06} seed={5} />
    </AbsoluteFill>
  );
};
