import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  AnimatedWindow,
  Backdrop,
  BeatFlash,
  BrowserFrame,
  Caption,
  Clip,
  GlowBackground,
  Pill,
  StoreHint,
  Watermark,
} from './components';
import { BLUE, CLIPS, CLIP_FRAMES, ClipInfo, FONT, PINK, REPO_URL, STORE_URL } from './theme';

/** Plays a recording at the speed that fills `duration` frames (never faster than real time). */
const fitRate = (clip: ClipInfo, duration: number) => {
  const frames = CLIP_FRAMES[clip.src] ?? duration;
  return frames >= duration ? 1 : frames / duration;
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const WINDOW_WIDTH = 1560;
const WINDOW_TOP = 60;

// ---------------------------------------------------------------- intro

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icon = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const title = spring({ frame: frame - 10, fps, config: { damping: 200 }, durationInFrames: 26 });
  const tagline = spring({ frame: frame - 26, fps, config: { damping: 200 }, durationInFrames: 26 });
  const badge = spring({ frame: frame - 44, fps, config: { damping: 200 }, durationInFrames: 22 });
  const glow = 0.6 + 0.4 * Math.sin(frame / 10);

  return (
    <AbsoluteFill>
      <GlowBackground />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#fff' }}>
        <Img
          src={staticFile('icon.png')}
          style={{
            width: 176,
            height: 176,
            transform: `scale(${icon})`,
            filter: `drop-shadow(0 0 ${40 * glow}px ${PINK}) drop-shadow(0 0 ${60 * glow}px ${BLUE})`,
          }}
        />
        <div
          style={{
            marginTop: 40,
            fontSize: 128,
            fontWeight: 800,
            letterSpacing: 12,
            opacity: title,
            transform: `translateY(${(1 - title) * 30}px)`,
            textShadow: `0 0 50px ${PINK}99, 0 0 90px ${BLUE}77`,
          }}
        >
          B站氛围光
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 34,
            letterSpacing: 10,
            color: 'rgba(255,255,255,.72)',
            opacity: title,
          }}
        >
          AMBIENT LIGHT FOR BILIBILI
        </div>
        <div
          style={{
            marginTop: 44,
            fontSize: 46,
            fontWeight: 600,
            letterSpacing: 6,
            opacity: tagline,
            transform: `translateY(${(1 - tagline) * 24}px)`,
          }}
        >
          让画面的光，溢出屏幕
        </div>
        <div style={{ marginTop: 34, opacity: badge, transform: `scale(${0.9 + badge * 0.1})` }}>
          <Pill accent size={28}>
            Chrome 应用商店 · 现已上架
          </Pill>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- before / after

export const Compare: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  // Opening shot: the "off" page is visible from frame 0 and the light sweeps in after half a second.
  const progress = interpolate(frame, [15, 78], [0, 100], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const labelOpacity = interpolate(frame, [2, 12], [0, 1], clamp);
  const rate = fitRate(CLIPS.kdaOn, duration); // both recordings have the same length, so they stay in sync
  // Labels sit in the black band baked into the top of this video, so they cover no page content.
  const label = (text: string, side: 'left' | 'right', accent: boolean): React.ReactNode => (
    <div style={{ position: 'absolute', top: 160, [side]: side === 'left' ? 44 : 470, opacity: labelOpacity }}>
      <Pill accent={accent} size={26}>
        {text}
      </Pill>
    </div>
  );

  return (
    <AbsoluteFill>
      <Backdrop src={CLIPS.kdaOn.src} playbackRate={rate} brightness={0.25 + 0.3 * (progress / 100)} />
      <Watermark />
      <AnimatedWindow
        duration={duration}
        width={WINDOW_WIDTH}
        top={WINDOW_TOP}
        url={CLIPS.kdaOn.url}
        title={CLIPS.kdaOn.title}
        instant
      >
        <Clip src={CLIPS.kdaOff.src} playbackRate={rate} />
        <Clip src={CLIPS.kdaOn.src} playbackRate={rate} style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }} />
        {progress > 0 && progress < 100 ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${progress}%`,
              width: 4,
              marginLeft: -2,
              background: `linear-gradient(${PINK}, ${BLUE})`,
              boxShadow: `0 0 24px 6px ${PINK}aa`,
            }}
          />
        ) : null}
        {label('开启氛围光', 'left', true)}
        {progress < 96 ? label('关闭', 'right', false) : null}
      </AnimatedWindow>
      <Caption title="一键开启，色彩溢出整个页面" subtitle="视频画面实时投射到网页背景，就像屏幕后亮起了一盏灯" delay={76} />
      <StoreHint />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- anime / game montage

export type MontagePart = { clip: ClipInfo; label: string; from: number; duration: number };

/** Fast beat-synced cuts between several recordings inside one browser window. */
export const Montage: React.FC<{ duration: number; parts: MontagePart[]; title: string; subtitle: string }> = ({
  duration,
  parts,
  title,
  subtitle,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = [...parts].reverse().find((p) => frame >= p.from) ?? parts[0];
  return (
    <AbsoluteFill>
      {parts.map((p) => (
        <Sequence key={p.clip.src} from={p.from} durationInFrames={p.duration} layout="none">
          <Backdrop src={p.clip.src} playbackRate={fitRate(p.clip, p.duration)} />
        </Sequence>
      ))}
      <Watermark />
      <AnimatedWindow duration={duration} width={WINDOW_WIDTH} top={WINDOW_TOP} url={active.clip.url} title={active.clip.title}>
        {parts.map((p) => {
          const tag = spring({ frame: frame - p.from - 2, fps, config: { damping: 200 }, durationInFrames: 14 });
          return (
            <Sequence key={p.clip.src} from={p.from} durationInFrames={p.duration} layout="none">
              <Clip src={p.clip.src} playbackRate={fitRate(p.clip, p.duration)} />
              {/* Tag sits on the player's top-left corner (inside the letterbox band when there is one) */}
              <div style={{ position: 'absolute', left: 70, top: 176, opacity: tag, transform: `translateX(${(1 - tag) * -30}px)` }}>
                <Pill accent size={24}>
                  {p.label}
                </Pill>
              </div>
            </Sequence>
          );
        })}
      </AnimatedWindow>
      {parts.map((p) => (
        <BeatFlash key={p.clip.src} at={p.from} />
      ))}
      <Caption title={title} subtitle={subtitle} delay={6} />
      <StoreHint />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- feature clips

export const Feature: React.FC<{
  clip: ClipInfo;
  duration: number;
  title: string;
  subtitle: string;
}> = ({ clip, duration, title, subtitle }) => (
  <AbsoluteFill>
    <Backdrop src={clip.src} playbackRate={fitRate(clip, duration)} />
    <Watermark />
    <AnimatedWindow duration={duration} width={WINDOW_WIDTH} top={WINDOW_TOP} url={clip.url} title={clip.title}>
      <Clip src={clip.src} playbackRate={fitRate(clip, duration)} />
    </AnimatedWindow>
    <Caption title={title} subtitle={subtitle} delay={14} />
    <StoreHint />
  </AbsoluteFill>
);

// ---------------------------------------------------------------- settings

const SETTINGS_RATE = 0.72; // stretches the 4 s Jinx recording over the scene

export const Settings: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const popup = spring({ frame: frame - 8, fps, config: { damping: 200 }, durationInFrames: 30 });
  const win = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const text = spring({ frame: frame - 16, fps, config: { damping: 200 }, durationInFrames: 26 });
  const presets = ['柔和', '沉浸', '满屏（默认）'];

  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff' }}>
      <Backdrop src={CLIPS.jinx.src} playbackRate={SETTINGS_RATE} brightness={0.45} />
      <Watermark />
      <div
        style={{
          position: 'absolute',
          left: 700,
          top: 96,
          opacity: text,
          transform: `translateY(${(1 - text) * 24}px)`,
        }}
      >
        <div style={{ fontSize: 58, fontWeight: 800, letterSpacing: 3 }}>随心调节，一键预设</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 22 }}>
          {presets.map((p, i) => (
            <Pill key={p} accent={i === 2} size={26}>
              {p}
            </Pill>
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 700,
          top: 268,
          opacity: win,
          transform: `translateX(${(1 - win) * 60}px)`,
        }}
      >
        <BrowserFrame url={CLIPS.jinx.url} title={CLIPS.jinx.title} width={1120}>
          <Clip src={CLIPS.jinx.src} playbackRate={SETTINGS_RATE} />
        </BrowserFrame>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 150,
          top: 70,
          height: 940,
          opacity: popup,
          transform: `translateX(${(1 - popup) * -80}px) perspective(1600px) rotateY(${(1 - popup) * 12 + 4}deg)`,
          transformOrigin: 'left center',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: `0 30px 90px rgba(0,0,0,.7), 0 0 60px ${PINK}33`,
          border: '1px solid rgba(255,255,255,.12)',
        }}
      >
        <Img src={staticFile('popup.png')} style={{ height: '100%', display: 'block' }} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 700,
          top: 960,
          fontSize: 30,
          color: 'rgba(255,255,255,.8)',
          letterSpacing: 2,
          opacity: text,
        }}
      >
        光晕范围 · 模糊 · 亮度 · 饱和度 · 渐隐曲线 · 帧率上限，调整实时生效
      </div>
      <StoreHint />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- outro

const SEARCH_TEXT = 'B站氛围光';

/** Call to action: where to get it. `beat` = frames per beat, for the pulsing install button. */
export const Outro: React.FC<{ beat: number }> = ({ beat }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 24 });
  const logo = enter(0);
  const headline = enter(8);
  const search = enter(18);
  const pills = enter(52);
  const footer = enter(62);

  // Typing effect in the search box, then a blinking caret.
  const typed = SEARCH_TEXT.slice(0, Math.max(0, Math.min(SEARCH_TEXT.length, Math.floor((frame - 26) / 4))));
  const doneTyping = typed.length === SEARCH_TEXT.length;
  const caretOn = Math.floor(frame / 12) % 2 === 0;
  const pulse = doneTyping ? 1 + 0.05 * Math.max(0, Math.cos(((frame % beat) / beat) * Math.PI)) : 1;

  return (
    <AbsoluteFill>
      <GlowBackground />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: logo, transform: `scale(${0.92 + logo * 0.08})` }}>
          <Img src={staticFile('icon.png')} style={{ width: 104, height: 104, filter: `drop-shadow(0 0 30px ${PINK}aa)` }} />
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: 6, textShadow: `0 0 40px ${PINK}88` }}>B站氛围光</div>
        </div>

        <div
          style={{
            marginTop: 34,
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: 4,
            opacity: headline,
            transform: `translateY(${(1 - headline) * 24}px)`,
          }}
        >
          现已上架{' '}
          <span
            style={{
              background: 'linear-gradient(90deg, #ff9ab8, #7cd8ff)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 2px 14px rgba(0,0,0,.55))',
            }}
          >
            Chrome 应用商店
          </span>
        </div>

        {/* Mock store search bar */}
        <div
          style={{
            marginTop: 44,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            opacity: search,
            transform: `translateY(${(1 - search) * 24}px)`,
          }}
        >
          <div
            style={{
              width: 760,
              height: 84,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '0 30px',
              borderRadius: 42,
              background: 'rgba(255,255,255,.1)',
              border: '1px solid rgba(255,255,255,.22)',
              backdropFilter: 'blur(18px)',
              boxShadow: '0 20px 60px rgba(0,0,0,.4)',
              fontSize: 38,
            }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <line x1="15.5" y1="15.5" x2="21" y2="21" />
            </svg>
            <span style={{ letterSpacing: 2 }}>{typed}</span>
            <span style={{ width: 3, height: 40, marginLeft: -12, background: '#fff', opacity: caretOn ? 0.9 : 0 }} />
          </div>
          <div
            style={{
              height: 84,
              display: 'flex',
              alignItems: 'center',
              padding: '0 40px',
              borderRadius: 42,
              background: `linear-gradient(90deg, ${PINK}, ${BLUE})`,
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: 2,
              boxShadow: `0 0 ${doneTyping ? 50 : 0}px ${PINK}88`,
              transform: `scale(${pulse})`,
            }}
          >
            免费安装
          </div>
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 44, opacity: pills, transform: `translateY(${(1 - pills) * 20}px)` }}>
          <Pill size={28}>Edge 浏览器同样可用</Pill>
          <Pill size={28}>完全本地运行</Pill>
          <Pill size={28}>不上传任何数据</Pill>
          <Pill size={28}>开源</Pill>
        </div>

        <div style={{ marginTop: 34, fontSize: 26, letterSpacing: 1, color: 'rgba(255,255,255,.62)', opacity: footer }}>
          {STORE_URL} · {REPO_URL}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
