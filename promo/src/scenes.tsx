import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { AnimatedWindow, Backdrop, Caption, Clip, GlowBackground, Pill, Watermark, BrowserFrame } from './components';
import { BLUE, CLIPS, ClipInfo, FONT, PINK } from './theme';

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
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- before / after

export const Compare: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [28, 100], [0, 100], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const labelOpacity = interpolate(frame, [18, 30], [0, 1], clamp);
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
      <Backdrop src={CLIPS.kdaOn.src} brightness={0.25 + 0.3 * (progress / 100)} />
      <Watermark />
      <AnimatedWindow duration={duration} width={WINDOW_WIDTH} top={WINDOW_TOP} url={CLIPS.kdaOn.url} title={CLIPS.kdaOn.title}>
        <Clip src={CLIPS.kdaOff.src} />
        <Clip src={CLIPS.kdaOn.src} style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }} />
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
      <Caption title="一键开启，色彩溢出整个页面" subtitle="视频画面实时投射到网页背景，就像屏幕后亮起了一盏灯" delay={96} />
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
    <Backdrop src={clip.src} />
    <Watermark />
    <AnimatedWindow duration={duration} width={WINDOW_WIDTH} top={WINDOW_TOP} url={clip.url} title={clip.title}>
      <Clip src={clip.src} />
    </AnimatedWindow>
    <Caption title={title} subtitle={subtitle} delay={14} />
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
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- outro

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const icon = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const pills = spring({ frame: frame - 16, fps, config: { damping: 200 }, durationInFrames: 26 });
  return (
    <AbsoluteFill>
      <GlowBackground />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, opacity: icon, transform: `scale(${0.92 + icon * 0.08})` }}>
          <Img src={staticFile('icon.png')} style={{ width: 150, height: 150, filter: `drop-shadow(0 0 40px ${PINK}aa)` }} />
          <div>
            <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: 8, textShadow: `0 0 50px ${PINK}88` }}>B站氛围光</div>
            <div style={{ fontSize: 30, letterSpacing: 8, color: 'rgba(255,255,255,.72)' }}>AMBIENT LIGHT FOR BILIBILI</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 64, opacity: pills, transform: `translateY(${(1 - pills) * 20}px)` }}>
          <Pill size={30}>Chrome 浏览器扩展</Pill>
          <Pill size={30}>完全本地运行</Pill>
          <Pill size={30}>不上传任何数据</Pill>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
