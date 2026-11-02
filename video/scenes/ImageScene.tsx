import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing, Img, staticFile } from 'remotion';
import { FilmGrain, ScanlinesVignette, clamp01 } from '../components/primitives';

export type ImageSceneProps = {
  /** 图片路径。支持 staticFile 相对路径或 http(s) 绝对地址 */
  src: string;
  /** 是否按 public/ 目录解析 */
  fromPublic?: boolean;
  /** 顶部标题 */
  title?: string;
  subtitle?: string;
  /** Ken Burns 方向 */
  pan?: 'in' | 'out' | 'left' | 'right' | 'up' | 'down';
  /** 1.0 = 无运动 */
  zoomAmount?: number;
  /** 叠加暗度 0..1 */
  dim?: number;
  accent?: string;
  fontFamily?: string;
  /** 入场方式 */
  enter?: 'fade' | 'wipe' | 'zoom';
};

/**
 * 图片镜头：Ken Burns 缓动 + 可选入场转场 + 叠加文字。
 */
export const ImageScene: React.FC<ImageSceneProps> = ({
  src,
  fromPublic = true,
  title,
  subtitle,
  pan = 'in',
  zoomAmount = 1.12,
  dim = 0.45,
  accent = '#00e5ff',
  fontFamily,
  enter = 'fade',
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();

  const p = clamp01(frame / Math.max(1, durationInFrames - 1));
  const eased = Easing.inOut(Easing.cubic)(p);

  const z = interpolate(eased, [0, 1], pan === 'out' ? [zoomAmount, 1] : [1, zoomAmount]);
  let tx = 0;
  let ty = 0;
  if (pan === 'left') tx = interpolate(eased, [0, 1], [0, -60]);
  if (pan === 'right') tx = interpolate(eased, [0, 1], [0, 60]);
  if (pan === 'up') ty = interpolate(eased, [0, 1], [0, -60]);
  if (pan === 'down') ty = interpolate(eased, [0, 1], [0, 60]);

  const enterP = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const enterOpacity = enter === 'fade' ? enterP : 1;
  const enterZoom = enter === 'zoom' ? interpolate(enterP, [0, 1], [1.18, 1]) : 1;
  const wipe = enter === 'wipe' ? enterP : 1;

  const titleP = interpolate(frame, [16, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const subP = interpolate(frame, [34, 56], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const url = fromPublic ? staticFile(src) : src;

  return (
    <AbsoluteFill style={{ backgroundColor: '#050607', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${z * enterZoom})`,
          opacity: enterOpacity,
          clipPath: enter === 'wipe' ? `inset(0 ${(1 - wipe) * 100}% 0 0)` : undefined,
        }}
      >
        <Img
          src={url}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      {/* 暗化 + 上下渐变 */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,${dim + 0.18}) 0%, rgba(0,0,0,${dim * 0.35}) 40%, rgba(0,0,0,${dim * 0.35}) 60%, rgba(0,0,0,${dim + 0.3}) 100%)`,
        }}
      />

      {(title || subtitle) && (
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            padding: `0 88px ${Math.round(height * 0.16)}px`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {title && (
              <div
                style={{
                  fontFamily,
                  fontSize: 82,
                  fontWeight: 900,
                  color: '#fff',
                  opacity: titleP,
                  transform: `translateY(${interpolate(titleP, [0, 1], [40, 0])}px)`,
                  lineHeight: 1.16,
                  textShadow: '0 4px 40px rgba(0,0,0,0.9)',
                }}
              >
                {title}
              </div>
            )}
            {subtitle && (
              <div
                style={{
                  fontFamily,
                  fontSize: 38,
                  color: 'rgba(255,255,255,0.78)',
                  opacity: subP,
                  borderLeft: `3px solid ${accent}`,
                  paddingLeft: 18,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
        </AbsoluteFill>
      )}

      <ScanlinesVignette vignette={0.62} />
      <FilmGrain opacity={0.05} seed={13} />
    </AbsoluteFill>
  );
};
