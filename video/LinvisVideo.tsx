import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Composition,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { ImpactTitle } from './scenes/ImpactTitle';
import { RevealQuestion } from './scenes/RevealQuestion';
import { ColdOpen } from './scenes/ColdOpen';
import { Dissolve } from './scenes/Dissolve';
import { ImageScene } from './scenes/ImageScene';
import { TextLines } from './scenes/TextLines';
import { ShapeMotion } from './scenes/ShapeMotion';
import { VoiceCaption } from './scenes/VoiceCaption';

/* ---------------- 字体 ---------------- */
const FONT_FAMILY = 'LinvisSans, "Noto Sans SC", "Microsoft YaHei", sans-serif';

const FontStyle: React.FC = () => (
  <style>{`
    @font-face {
      font-family: 'LinvisSans';
      src: url('${staticFile('fonts/NotoSansSC-VF.ttf')}') format('truetype');
      font-weight: 100 900;
      font-display: block;
    }
    * { -webkit-font-smoothing: antialiased; }
  `}</style>
);

/* ---------------- 配置类型 ---------------- */
export type SceneConfig = {
  id: string;
  type: 'impact-title' | 'reveal-question' | 'image-scene' | 'text-lines' | 'shape-motion' | 'voice-caption' | 'cold-open' | 'dissolve' | 'blank';
  from: number;
  durationInFrames: number;
  props?: Record<string, any>;
  /** 转场：进入本镜头时的淡入帧数 */
  transitionIn?: { type?: 'fade' | 'none'; frames?: number };
  transitionOut?: { type?: 'fade' | 'none'; frames?: number };
};

export type AudioLayer = {
  id: string;
  src: string;
  from: number;
  volume?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  loop?: boolean;
  placeholder?: boolean;
};

export type LinvisVideoProps = {
  id?: string;
  title?: string;
  video: {
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
    backgroundColor?: string;
  };
  theme?: {
    accent?: string;
    accentAlt?: string;
    ink?: string;
    fontFamily?: string;
  };
  scenes: SceneConfig[];
  audio?: { layers?: AudioLayer[] };
  captions?: { enabled?: boolean; words?: any[]; captions?: any[] };
};

/* ---------------- 场景渲染 ---------------- */
const SceneRenderer: React.FC<{ scene: SceneConfig; theme: LinvisVideoProps['theme']; captions?: LinvisVideoProps['captions'] }> = ({
  scene,
  theme,
  captions,
}) => {
  const common = {
    accent: theme?.accent,
    accentAlt: theme?.accentAlt,
    ink: theme?.ink,
    fontFamily: theme?.fontFamily ?? FONT_FAMILY,
  };
  const p = scene.props ?? {};

  switch (scene.type) {
    case 'impact-title':
      return <ImpactTitle {...common} {...p} />;
    case 'cold-open':
      return <ColdOpen {...common} {...p} />;
    case 'dissolve':
      return <Dissolve {...common} {...p} />;
    case 'reveal-question':
      return <RevealQuestion {...common} {...p} />;
    case 'image-scene':
      return <ImageScene {...common} {...p} />;
    case 'text-lines':
      return <TextLines {...common} {...p} />;
    case 'shape-motion':
      return <ShapeMotion {...common} {...p} />;
    case 'voice-caption':
      return <VoiceCaption {...common} {...p} headline={p.headline} captions={p.captions ?? captions?.captions} words={p.words ?? captions?.words} />;
    case 'blank':
    default:
      return <AbsoluteFill style={{ backgroundColor: '#000' }} />;
  }
};

/** 转场包装：淡入/淡出，纯黑过渡，不引入额外依赖。 */
const TransitionWrap: React.FC<{ scene: SceneConfig; children: React.ReactNode }> = ({ scene, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const inFrames = scene.transitionIn?.type === 'none' ? 0 : (scene.transitionIn?.frames ?? 0);
  const outFrames = scene.transitionOut?.type === 'none' ? 0 : (scene.transitionOut?.frames ?? 0);

  let opacity = 1;
  if (inFrames > 0) {
    opacity = Math.min(opacity, interpolate(frame, [0, inFrames], [0, 1], { extrapolateRight: 'clamp' }));
  }
  if (outFrames > 0) {
    opacity = Math.min(opacity, interpolate(frame, [durationInFrames - outFrames, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  }
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** 字幕全局覆盖层（当 captions.enabled 且场景未自带词级时间轴时） */
const CaptionOverlay: React.FC<{ captions?: LinvisVideoProps['captions']; fontFamily: string; accent?: string }> = ({
  captions,
  fontFamily,
  accent,
}) => {
  if (!captions?.enabled || !captions.captions?.length) return null;
  const frame = useCurrentFrame();
  const active = captions.captions.find((c: any) => frame >= c.from && frame < c.to);
  if (!active) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 240, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 900,
          fontFamily,
          fontSize: 52,
          fontWeight: 800,
          color: '#fff',
          textAlign: 'center',
          lineHeight: 1.34,
          padding: '16px 26px',
          background: 'rgba(0,0,0,0.45)',
          borderLeft: `4px solid ${accent ?? '#00e5ff'}`,
          textShadow: '0 2px 18px rgba(0,0,0,0.9)',
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};

/* ---------------- 主合成 ---------------- */
export const LinvisVideo: React.FC<LinvisVideoProps> = ({ video, theme, scenes, audio, captions }) => {
  const fontFamily = theme?.fontFamily ?? FONT_FAMILY;
  return (
    <AbsoluteFill style={{ backgroundColor: video.backgroundColor ?? '#050607' }}>
      <FontStyle />

      {scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames} name={`${scene.id} · ${scene.type}`}>
          <TransitionWrap scene={scene}>
            <SceneRenderer scene={scene} theme={theme} captions={captions} />
          </TransitionWrap>
        </Sequence>
      ))}

      <CaptionOverlay captions={captions} fontFamily={fontFamily} accent={theme?.accent} />

      {(audio?.layers ?? []).map((layer) => (
        <Sequence key={layer.id} from={layer.from} durationInFrames={Math.max(1, video.durationInFrames - layer.from)} name={`audio · ${layer.id}`}>
          <Audio
            src={layer.src.startsWith('http') ? layer.src : staticFile(layer.src)}
            volume={(f) => {
              const base = layer.volume ?? 1;
              const fi = layer.fadeInFrames ?? 0;
              const fo = layer.fadeOutFrames ?? 0;
              const total = Math.max(1, video.durationInFrames - layer.from);
              let v = base;
              if (fi > 0) v = Math.min(v, interpolate(f, [0, fi], [0, base], { extrapolateRight: 'clamp' }));
              if (fo > 0) v = Math.min(v, interpolate(f, [total - fo, total], [base, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
              return v;
            }}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/* ---------------- Composition 注册 ---------------- */
/** 由 linvis CLI 通过 inputProps 注入真实配置；此默认值仅用于 Studio 打开时占位。 */
const DEFAULT_PROPS: LinvisVideoProps = {
  id: 'placeholder',
  title: 'Linvis placeholder',
  video: { width: 1080, height: 1920, fps: 30, durationInFrames: 90, backgroundColor: '#050607' },
  theme: { accent: '#00e5ff', accentAlt: '#ff0044', ink: '#ffffff' },
  scenes: [
    { id: 'p1', type: 'impact-title', from: 0, durationInFrames: 90, props: { text: 'AI 要取代人类了！', hitFrame: 20 } },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LinvisVideo"
      component={LinvisVideo}
      durationInFrames={DEFAULT_PROPS.video.durationInFrames}
      fps={DEFAULT_PROPS.video.fps}
      width={DEFAULT_PROPS.video.width}
      height={DEFAULT_PROPS.video.height}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={({ props }: { props: LinvisVideoProps }) => {
        const v = props?.video ?? DEFAULT_PROPS.video;
        return {
          durationInFrames: Math.max(1, v.durationInFrames),
          fps: v.fps,
          width: v.width,
          height: v.height,
        };
      }}
    />
  );
};
