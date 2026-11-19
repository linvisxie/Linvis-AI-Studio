import React from 'react';
import { Video } from '@remotion/media';
import { AbsoluteFill, Easing, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp01, FittedText } from '../components/primitives';

export type VideoSceneProps = {
  src: string;
  fromPublic?: boolean;
  /** Source offset in frames, not seconds. */
  startFrom?: number;
  volume?: number;
  fit?: 'cover' | 'contain';
  title?: string;
  subtitle?: string;
  dim?: number;
  zoomAmount?: number;
  enterFrames?: number;
  exitFrames?: number;
  durationInFrames?: number;
  fontFamily?: string;
  accent?: string;
  renderMode?: 'final' | 'editor';
};

/** Decode actual source frames; animation and fades are bounded by this scene. */
export const VideoScene: React.FC<VideoSceneProps> = ({
  src, fromPublic = true, startFrom = 0, volume = 0, fit = 'cover',
  title, subtitle, dim = 0.15, zoomAmount = 1.03, enterFrames = 12,
  exitFrames = 12, durationInFrames, fontFamily, accent = '#d6ad68', renderMode,
}) => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();
  const duration = durationInFrames ?? config.durationInFrames;
  const last = Math.max(1, duration - 1);
  const progress = Easing.inOut(Easing.cubic)(clamp01(frame / last));
  const fade = Math.min(
    enterFrames > 0 ? clamp01(frame / Math.min(enterFrames, last)) : 1,
    exitFrames > 0 ? clamp01((duration - 1 - frame) / Math.min(exitFrames, last)) : 1,
  );
  const silent = renderMode === 'editor' || volume <= 0;
  return (
    <AbsoluteFill style={{ background: '#080a0c', overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity: fade, transform: `scale(${1 + (Math.max(1, Math.min(1.2, zoomAmount)) - 1) * progress})` }}>
        <Video src={fromPublic && !/^(https?:|data:|blob:)/.test(src) ? staticFile(src) : src}
          trimBefore={Math.max(0, Math.round(startFrom))} muted={silent} volume={silent ? 0 : volume}
          style={{ width: '100%', height: '100%', objectFit: fit }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `rgba(0,0,0,${clamp01(dim)})` }} />
      <div style={{ position: 'absolute', left: '8.3333%', right: '8.3333%', bottom: '20%', opacity: fade }}>
        {title && <FittedText text={title} maxWidth={config.width * 5 / 6} maxHeight={config.height * 0.16} maxSize={76} minSize={20} family={fontFamily} color="#f2eee5" align="left" />}
        {subtitle && <FittedText text={subtitle} maxWidth={config.width * 5 / 6} maxHeight={100} maxSize={34} minSize={16} family={fontFamily} color={accent} align="left" style={{ marginTop: 20 }} />}
      </div>
    </AbsoluteFill>
  );
};
