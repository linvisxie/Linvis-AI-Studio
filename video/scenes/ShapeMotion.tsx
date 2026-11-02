import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { FilmGrain, ScanlinesVignette } from '../components/primitives';

export type ShapeMotionProps = {
  /** 图形种类 */
  shape?: 'grid' | 'rings' | 'nodes' | 'bars' | 'circuit';
  label?: string;
  caption?: string;
  accent?: string;
  accentAlt?: string;
  fontFamily?: string;
  /** 主色数量密度 */
  density?: number;
  /** 整体旋转速度 (deg/s)，0 = 静止 */
  spin?: number;
};

const seeded = (n: number) => {
  const x = Math.sin(n * 91.7 + 41.3) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * 图形与文字动画镜头：用几何图形表达抽象概念（无外部素材）。
 */
export const ShapeMotion: React.FC<ShapeMotionProps> = ({
  shape = 'grid',
  label,
  caption,
  accent = '#00e5ff',
  accentAlt = '#ff0044',
  fontFamily,
  density = 12,
  spin = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const labelP = interpolate(frame, [10, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const captionP = interpolate(frame, [30, 54], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const rot = spin ? (t * spin) % 360 : 0;

  const renderShape = () => {
    if (shape === 'grid') {
      const n = Math.max(4, Math.round(density));
      const gap = width / n;
      return (
        <svg width={width} height={height}>
          {Array.from({ length: n }).map((_, i) => {
            const x = i * gap + gap / 2;
            const phase = seeded(i) * Math.PI * 2;
            const amp = 60 + seeded(i + 5) * 190;
            const y = height / 2 + Math.sin(t * 1.3 + phase) * amp;
            return (
              <g key={i}>
                <line x1={x} y1={0} x2={x} y2={height} stroke={accent} strokeOpacity={0.07} strokeWidth={1} />
                <circle cx={x} cy={y} r={3 + seeded(i + 9) * 5} fill={accent} opacity={0.55 + 0.35 * Math.sin(t * 2 + phase)} />
              </g>
            );
          })}
        </svg>
      );
    }

    if (shape === 'rings') {
      return (
        <svg width={width} height={height} style={{ transform: `rotate(${rot}deg)` }}>
          {Array.from({ length: Math.max(3, Math.round(density / 3)) }).map((_, i) => {
            const r = 100 + i * 96 + Math.sin(t * 0.9 + i) * 22;
            const o = 0.34 - i * 0.05;
            return (
              <g key={i}>
                <circle cx={width / 2} cy={height / 2} r={r} fill="none" stroke={i % 2 ? accentAlt : accent} strokeOpacity={Math.max(0.06, o)} strokeWidth={1.6} strokeDasharray={i % 3 === 0 ? '12 22' : undefined} />
                <circle
                  cx={width / 2 + Math.cos(t * (0.6 + i * 0.22) + i) * r}
                  cy={height / 2 + Math.sin(t * (0.6 + i * 0.22) + i) * r}
                  r={4}
                  fill={accent}
                  opacity={0.9}
                />
              </g>
            );
          })}
        </svg>
      );
    }

    if (shape === 'nodes') {
      const n = Math.max(6, Math.round(density));
      const pts = Array.from({ length: n }).map((_, i) => {
        const a = (i / n) * Math.PI * 2 + t * 0.15;
        const rad = Math.min(width, height) * (0.18 + seeded(i) * 0.2);
        return {
          x: width / 2 + Math.cos(a) * rad * 1.1,
          y: height / 2 + Math.sin(a) * rad,
        };
      });
      return (
        <svg width={width} height={height}>
          {pts.map((p, i) =>
            pts.map((q, j) => {
              if (j <= i) return null;
              const d = Math.hypot(p.x - q.x, p.y - q.y);
              if (d > Math.min(width, height) * 0.34) return null;
              return <line key={`${i}-${j}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={accent} strokeOpacity={0.12} strokeWidth={1} />;
            }),
          )}
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3.6} fill={i % 4 === 0 ? accentAlt : accent} opacity={0.85} />
          ))}
        </svg>
      );
    }

    if (shape === 'bars') {
      const n = Math.max(6, Math.round(density));
      const bw = width / (n * 1.6);
      return (
        <svg width={width} height={height}>
          {Array.from({ length: n }).map((_, i) => {
            const h = (0.12 + Math.abs(Math.sin(t * 1.7 + i * 0.7)) * 0.62 + seeded(i) * 0.16) * height;
            const x = i * bw * 1.6 + bw * 0.4;
            return <rect key={i} x={x} y={height - h} width={bw} height={h} fill={i % 3 === 0 ? accentAlt : accent} opacity={0.35 + seeded(i) * 0.4} rx={3} />;
          })}
        </svg>
      );
    }

    // circuit
    return (
      <svg width={width} height={height}>
        {Array.from({ length: Math.max(8, Math.round(density)) }).map((_, i) => {
          const y = (i / Math.max(8, Math.round(density))) * height;
          const off = Math.sin(t * (0.7 + seeded(i) * 1.4) + i) * 120;
          return (
            <g key={i}>
              <path
                d={`M 0 ${y} H ${width * 0.3 + off} V ${y + (seeded(i) > 0.5 ? 90 : -90)} H ${width}`}
                fill="none"
                stroke={accent}
                strokeOpacity={0.1 + seeded(i) * 0.1}
                strokeWidth={1.4}
              />
              <circle cx={width * 0.3 + off} cy={y} r={3} fill={accentAlt} opacity={0.7} />
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <AbsoluteFill style={{ backgroundColor: '#04060b', overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity: 0.95 }}>{renderShape()}</AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 80px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          {label && (
            <div
              style={{
                fontFamily,
                fontSize: 84,
                fontWeight: 900,
                color: '#fff',
                opacity: labelP,
                transform: `translateY(${(1 - labelP) * 26}px)`,
                textAlign: 'center',
                textShadow: `0 0 44px ${accent}55, 0 4px 30px rgba(0,0,0,0.9)`,
              }}
            >
              {label}
            </div>
          )}
          {caption && (
            <div style={{ fontFamily, fontSize: 34, color: 'rgba(232,238,242,0.66)', opacity: captionP, letterSpacing: 2, textAlign: 'center' }}>
              {caption}
            </div>
          )}
        </div>
      </AbsoluteFill>

      <ScanlinesVignette vignette={0.84} />
      <FilmGrain opacity={0.05} seed={23} />
    </AbsoluteFill>
  );
};
