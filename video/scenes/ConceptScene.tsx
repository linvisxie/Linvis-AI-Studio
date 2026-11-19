import React from 'react';
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp01, FittedText } from '../components/primitives';

export type ConceptSceneProps = {
  variant?: 'glass-box' | 'capability-grid' | 'human-network' | 'question';
  title?: string;
  headline?: string;
  subtitle?: string;
  kicker?: string;
  labels?: string[];
  src?: string;
  fromPublic?: boolean;
  imageOpacity?: number;
  accent?: string;
  ink?: string;
  fontFamily?: string;
  durationInFrames?: number;
};

const DEFAULTS = {
  'glass-box': { title: '能力，在边界内生长', kicker: '01 / THE GLASS BOX', subtitle: '看见输出，也看见边界' },
  'capability-grid': { title: '从一种能力，到无数可能', kicker: '02 / CAPABILITY EXPANSION', subtitle: '语言 · 视觉 · 推理 · 创造' },
  'human-network': { title: '连接越来越像思考', kicker: '03 / PATTERNS OF THOUGHT', subtitle: '相似的结构，不等于相同的心智' },
  question: { title: '它，真的像人吗？', kicker: '04 / THE HUMAN QUESTION', subtitle: '能力的扩张，是否意味着理解？' },
};
const nodes = Array.from({ length: 24 }, (_, i) => {
  const angle = i * 2.399963;
  const radius = 48 + Math.sqrt(i / 23) * 225;
  return { x: 450 + Math.cos(angle) * radius, y: 365 + Math.sin(angle) * radius * 0.9 };
});

/** Quiet, deterministic visual metaphors. Layout uses a 1080×1920 design space. */
export const ConceptScene: React.FC<ConceptSceneProps> = ({
  variant = 'glass-box', title, headline, subtitle, kicker, labels,
  src, fromPublic = true, imageOpacity = 0.22, accent = '#d6ad68', ink = '#f2eee5',
  fontFamily, durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames: compositionDuration } = useVideoConfig();
  const duration = durationInFrames ?? compositionDuration;
  const reveal = Easing.out(Easing.cubic)(clamp01(frame / Math.max(1, Math.min(fps * 1.2, duration * 0.35))));
  const progress = clamp01(frame / Math.max(1, duration - 1));
  const defaults = DEFAULTS[variant];
  const text = (value: string, maxWidth: number, maxHeight: number, size: number, color = ink) => (
    <FittedText text={value} maxWidth={maxWidth} maxHeight={maxHeight} maxSize={size} minSize={12} family={fontFamily} color={color} align="left" weight={600} />
  );
  const cellLabels = (labels?.length ? labels : ['语言', '视觉', '推理', '代码', '创造', '行动']).slice(0, 9);
  return (
    <AbsoluteFill style={{ background: '#090c0e', overflow: 'hidden' }}>
      {src && <Img src={fromPublic && !/^(https?:|data:|blob:)/.test(src) ? staticFile(src) : src}
        style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: clamp01(imageOpacity), transform: `scale(${1.02 + progress * 0.035})` }} />}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent, rgba(5,7,9,0.8)), linear-gradient(180deg, rgba(5,7,9,0.3), transparent 50%, #090c0e)' }} />
      <div style={{ position: 'absolute', width: 1080, height: 1920, transform: `scale(${width / 1080}, ${height / 1920})`, transformOrigin: 'top left' }}>
        <div style={{ position: 'absolute', top: 150, left: 90, width: 900, opacity: reveal }}>
          {text(kicker ?? defaults.kicker, 900, 60, 24, accent)}
          <div style={{ height: 1, background: `${accent}66`, marginTop: 26, width: 900 * reveal }} />
        </div>
        <div style={{ position: 'absolute', left: 90, top: 310, width: 900, opacity: reveal, transform: `translateY(${(1 - reveal) * 22}px)` }}>
          {text(title ?? headline ?? defaults.title, 900, 270, 82)}
        </div>
        <svg width="900" height="740" viewBox="0 0 900 740" style={{ position: 'absolute', left: 90, top: 640, opacity: reveal }}>
          {/* Registration marks keep the graphic precise rather than a floating caption. */}
          <path d="M0 35 V0 H35 M865 0 H900 V35 M0 705 V740 H35 M865 740 H900 V705" fill="none" stroke={ink} strokeOpacity="0.24" />
          {variant === 'glass-box' && <g fill="none" stroke={accent} strokeWidth="1.5">
            <path d="M220 200 L570 140 L710 240 L360 300 Z M220 200 V500 L360 610 L710 550 V240 M360 300 V610 M220 500 L570 440 L710 550 M570 140 V440" strokeOpacity="0.7" />
            {[0, 1, 2, 3, 4].map(i => <path key={i} d={`M${250 + i * 65} ${230 - i * 11} V${490 - i * 11}`} strokeOpacity="0.12" />)}
            <rect x="290" y="310" width="320" height="190" rx="9" fill="#0c1418" fillOpacity="0.92" stroke={ink} strokeOpacity="0.3" />
            <path d="M290 345 H610" stroke={ink} strokeOpacity="0.2" />
            {[0, 1, 2].map(i => <circle key={i} cx={310 + i * 17} cy="329" r="3" fill={accent} />)}
            {[0, 1, 2, 3].map(i => <path key={i} d={`M315 ${375 + i * 27} h${(90 + i * 35) * reveal}`} stroke={i === 2 ? accent : ink} strokeOpacity="0.65" />)}
            <circle cx={450} cy={414} r={190 + progress * 25} strokeOpacity="0.12" strokeDasharray="3 12" />
            {(labels ?? []).slice(0, 4).map((label, i) => <g key={label}>
              <rect x={30 + i * 224} y="635" width="174" height="62" rx="8" fill="#10191c" strokeOpacity="0.55" />
              <text x={117 + i * 224} y="675" fill={ink} stroke="none" fontFamily={fontFamily} fontSize="26" textAnchor="middle">{label}</text>
              {i < 3 && <path d={`M${207 + i * 224} 665 h35 m-7 -5 l7 5 -7 5`} strokeOpacity="0.55" />}
            </g>)}
          </g>}
          {variant === 'capability-grid' && <g>
            <path d="M100 370 H800 M450 80 V660" stroke={accent} strokeOpacity="0.15" />
            {cellLabels.map((label, i) => {
              const x = 48 + (i % 3) * 278;
              const y = 110 + Math.floor(i / 3) * 190;
              const p = clamp01((frame / fps - i * 0.14) / 0.7);
              return <g key={i} opacity={p} transform={`translate(0, ${(1 - p) * 15})`}>
                <rect x={x} y={y} width="248" height="160" rx="5" fill="#10191c" fillOpacity="0.85" stroke={accent} strokeOpacity="0.4" />
                <circle cx={x + 24} cy={y + 25} r="4" fill={accent} />
                <path d={`M${x + 24} ${y + 126} h${180 * p}`} stroke={accent} strokeWidth="2" />
                <foreignObject x={x + 24} y={y + 50} width="200" height="65">{text(label, 200, 65, 35)}</foreignObject>
              </g>;
            })}
          </g>}
          {(variant === 'human-network' || (variant === 'question' && !src)) && <g>
            {/* Two hemispheres, folds, and a neural network: metaphor, not a factual diagram. */}
            <path d="M447 175 C350 110 245 185 260 270 C170 300 190 420 250 445 C215 535 340 590 405 535 L450 555 L495 535 C560 590 685 535 650 445 C710 420 730 300 640 270 C655 185 550 110 453 175 Z M450 180 V550 M300 240 Q400 210 390 320 T330 430 M600 240 Q500 210 510 320 T570 430 M265 375 Q330 340 370 390 M635 375 Q570 340 530 390" fill="none" stroke={ink} strokeWidth="2" strokeOpacity={variant === 'question' ? 0.28 : 0.5} />
            {nodes.map((n, i) => {
              const other = nodes[(i + 5) % nodes.length];
              return <g key={i} opacity={clamp01(reveal * 2 - i / 30)}>
                <line x1={n.x} y1={n.y} x2={other.x} y2={other.y} stroke={accent} strokeOpacity="0.23" />
                <circle cx={n.x} cy={n.y} r={3 + Math.sin(progress * Math.PI * 2 + i) * 0.8} fill={accent} />
              </g>;
            })}
            {variant === 'human-network' && (labels ?? []).slice(0, 4).map((label, i) => <g key={label}>
              <circle cx={120 + i * 220} cy="635" r="5" fill={accent} />
              <text x={120 + i * 220} y="687" fill={ink} fontFamily={fontFamily} fontSize="26" textAnchor="middle">{label}</text>
            </g>)}
            {variant === 'question' && <g>
              <circle cx="450" cy="365" r={112 + progress * 7} fill="#090c0e" fillOpacity="0.92" stroke={accent} strokeOpacity="0.7" />
              <foreignObject x="390" y="270" width="120" height="190"><FittedText text="?" maxWidth={120} maxHeight={190} maxSize={150} family={fontFamily} color={ink} weight={400} /></foreignObject>
            </g>}
          </g>}
        </svg>
        <div style={{ position: 'absolute', left: 90, top: 1440, width: 900, opacity: reveal }}>
          <div style={{ width: 48, height: 2, background: accent, marginBottom: 24 }} />
          {text(subtitle ?? defaults.subtitle, 900, 120, 36, '#c0beb7')}
        </div>
      </div>
    </AbsoluteFill>
  );
};
