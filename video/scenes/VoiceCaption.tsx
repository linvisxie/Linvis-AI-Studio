import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { FilmGrain, ScanlinesVignette, FittedText } from '../components/primitives';

export type Caption = { from: number; to: number; text: string };
export type WordTiming = { text: string; from: number; to: number };

export type VoiceCaptionProps = {
  /** 段落级字幕（帧为单位，相对本镜头起点） */
  captions?: Caption[];
  /** 词级时间轴（优先使用，逐词高亮） */
  words?: WordTiming[];
  /** 画面背景标题 */
  headline?: string;
  fontFamily?: string;
  accent?: string;
  ink?: string;
  fontSize?: number;
  /** 底部距离 */
  bottom?: number;
  /** 说话人标签 */
  speaker?: string;
  /** Disable transcription only; keep headline and background animation. */
  showCaptions?: boolean;
};

/**
 * 真人配音驱动镜头：画面为主，字幕逐词高亮。
 * 输入时间轴来自 faster-whisper 转写（词级时间戳）。
 */
export const VoiceCaption: React.FC<VoiceCaptionProps> = ({
  captions = [],
  words = [],
  headline,
  fontFamily,
  accent = '#00e5ff',
  ink = '#ffffff',
  fontSize = 54,
  bottom = 260,
  speaker,
  showCaptions = true,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  const activeCaption = captions.find((c) => frame >= c.from && frame < c.to) ?? null;

  // 词级：找出当前窗口内的词（±2 帧容差）
  const windowWords = words.filter((w) => frame >= w.from - 2 && frame <= w.to + 6);
  const activeWords = windowWords.length ? windowWords : words.filter((w) => {
    // 若当前帧落在词间隙，保持显示最近的词
    const prev = words.filter((w) => w.to <= frame).pop();
    return prev && w === prev;
  });
  const activeIndex = activeWords.findIndex((w) => frame >= w.from && frame <= w.to);

  const headP = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

  return (
    <AbsoluteFill style={{ backgroundColor: '#05070c', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at 50% 38%, rgba(0,80,130,0.16) 0%, rgba(0,0,0,0) 58%), linear-gradient(180deg, #05070c, #080b12, #05070c)',
        }}
      />

      {headline && (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 90px' }}>
          <FittedText text={headline} maxWidth={width - 180} maxHeight={420} maxSize={76} minSize={20}
            family={fontFamily} color="rgba(255,255,255,0.92)" weight={800}
            lineHeight={1.3} style={{ opacity: headP * 0.9 }} />
        </AbsoluteFill>
      )}

      {/* 字幕轨 */}
      {showCaptions && <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom }}>
        <div
          style={{
            maxWidth: width - 120,
            background: 'rgba(0,0,0,0.42)',
            backdropFilter: 'blur(2px)',
            borderLeft: `4px solid ${accent}`,
            padding: '20px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {speaker && (
            <div style={{ fontFamily, fontSize: 24, letterSpacing: 4, color: accent, opacity: 0.85 }}>
              {speaker}
            </div>
          )}

          {words.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px' }}>
              {activeWords.map((w, i) => {
                const isActive = i === activeIndex || (activeIndex === -1 && i === activeWords.length - 1);
                return (
                  <span
                    key={`${w.from}-${i}`}
                    style={{
                      fontFamily,
                      fontSize,
                      fontWeight: isActive ? 900 : 700,
                      color: isActive ? accent : ink,
                      textShadow: isActive ? `0 0 26px ${accent}88` : '0 2px 14px rgba(0,0,0,0.85)',
                      transition: 'none',
                      lineHeight: 1.28,
                    }}
                  >
                    {w.text}
                  </span>
                );
              })}
            </div>
          ) : activeCaption ? (
            <div style={{ fontFamily, fontSize, fontWeight: 800, color: ink, lineHeight: 1.32, textShadow: '0 2px 18px rgba(0,0,0,0.9)' }}>
              {activeCaption.text}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>}

      <ScanlinesVignette vignette={0.7} />
      <FilmGrain opacity={0.04} seed={29} />
    </AbsoluteFill>
  );
};
