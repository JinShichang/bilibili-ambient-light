import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BLUE, FONT, PINK } from './theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * A recorded page clip. The recordings are slightly zoomed so the browser's scrollbar and the
 * WebBridge "agent is working" edge glow at the viewport border are cropped away.
 */
export const Clip: React.FC<{
  src: string;
  playbackRate?: number;
  crop?: number;
  style?: React.CSSProperties;
}> = ({ src, playbackRate = 1, crop = 1.035, style }) => (
  <AbsoluteFill style={{ overflow: 'hidden', ...style }}>
    <OffthreadVideo
      src={staticFile(src)}
      muted
      playbackRate={playbackRate}
      style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${crop})` }}
    />
  </AbsoluteFill>
);

/** The promo's own "ambient light": a heavily blurred copy of the clip behind everything. */
export const Backdrop: React.FC<{ src: string; playbackRate?: number; brightness?: number }> = ({
  src,
  playbackRate = 1,
  brightness = 0.55,
}) => (
  <AbsoluteFill style={{ backgroundColor: '#05060a' }}>
    <OffthreadVideo
      src={staticFile(src)}
      muted
      playbackRate={playbackRate}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: 'scale(1.3)',
        filter: `blur(80px) saturate(1.35) brightness(${brightness})`,
      }}
    />
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.7) 100%)' }} />
  </AbsoluteFill>
);

/** Slowly drifting pink/blue glow, used for the intro and outro. */
export const GlowBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const a = frame / 90;
  const blob = (color: string, x: number, y: number, size: number): React.CSSProperties => ({
    position: 'absolute',
    left: x - size / 2,
    top: y - size / 2,
    width: size,
    height: size,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
    filter: 'blur(40px)',
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#05060a', overflow: 'hidden' }}>
      <div style={blob(`${PINK}cc`, 760 + Math.cos(a) * 160, 480 + Math.sin(a * 1.3) * 90, 1100)} />
      <div style={blob(`${BLUE}bb`, 1180 + Math.sin(a * 0.9) * 170, 600 + Math.cos(a * 1.1) * 100, 1150)} />
      <div style={blob('#7b5cff88', 960 + Math.sin(a * 0.6) * 260, 300 + Math.cos(a * 0.8) * 60, 800)} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 20%, rgba(0,0,0,.75) 100%)' }} />
    </AbsoluteFill>
  );
};

/** Fades a scene in (it is layered on top of the previous one) and optionally out. */
export const FadeIn: React.FC<{ duration: number; fade: number; fadeOut?: boolean; children: React.ReactNode }> = ({
  duration,
  fade,
  fadeOut = false,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity = fadeOut
    ? interpolate(frame, [0, fade, duration - fade, duration], [0, 1, 1, 0], clamp)
    : interpolate(frame, [0, fade], [0, 1], clamp);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** A dark Chrome-like window around a recording. Content area is 16:9. */
export const BrowserFrame: React.FC<{
  url: string;
  title: string;
  width: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ url, title, width, style, children }) => {
  const barHeight = Math.round(width * 0.034);
  const font = Math.round(barHeight * 0.36);
  const dot = (color: string): React.CSSProperties => ({
    width: font * 0.9,
    height: font * 0.9,
    borderRadius: '50%',
    background: color,
  });
  return (
    <div
      style={{
        width,
        borderRadius: 18,
        overflow: 'hidden',
        background: '#202124',
        border: '1px solid rgba(255,255,255,.1)',
        boxShadow: '0 40px 120px rgba(0,0,0,.65), 0 0 0 1px rgba(0,0,0,.4)',
        fontFamily: FONT,
        ...style,
      }}
    >
      <div
        style={{
          height: barHeight,
          display: 'flex',
          alignItems: 'center',
          gap: font * 0.8,
          padding: `0 ${font}px`,
          color: 'rgba(255,255,255,.82)',
          fontSize: font,
        }}
      >
        <div style={{ display: 'flex', gap: font * 0.5 }}>
          <div style={dot('#ff5f57')} />
          <div style={dot('#febc2e')} />
          <div style={dot('#28c840')} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: font * 0.5,
            maxWidth: width * 0.3,
            padding: `${font * 0.35}px ${font * 0.8}px`,
            borderRadius: font * 0.6,
            background: '#35363a',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <Img src={staticFile('icon.png')} style={{ width: font * 1.2, height: font * 1.2, flex: 'none' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        </div>
        <div
          style={{
            flex: 1,
            padding: `${font * 0.35}px ${font * 0.9}px`,
            borderRadius: font,
            background: '#2b2c2f',
            color: 'rgba(255,255,255,.62)',
            whiteSpace: 'nowrap',
          }}
        >
          🔒 {url}
        </div>
      </div>
      <div style={{ position: 'relative', width, height: Math.round((width * 9) / 16) }}>{children}</div>
    </div>
  );
};

/** Title + subtitle in a frosted pill, sliding up. */
export const Caption: React.FC<{ title: string; subtitle?: string; delay?: number; bottom?: number }> = ({
  title,
  subtitle,
  delay = 10,
  bottom = 56,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 24 });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom }}>
      <div
        style={{
          opacity: s,
          transform: `translateY(${(1 - s) * 40}px)`,
          padding: '22px 48px 24px',
          borderRadius: 28,
          background: 'rgba(8,8,14,.58)',
          backdropFilter: 'blur(24px) saturate(140%)',
          border: '1px solid rgba(255,255,255,.12)',
          boxShadow: '0 20px 60px rgba(0,0,0,.45)',
          textAlign: 'center',
          fontFamily: FONT,
          color: '#fff',
        }}
      >
        <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: 2 }}>{title}</div>
        {subtitle ? (
          <div style={{ marginTop: 8, fontSize: 27, color: 'rgba(255,255,255,.78)', letterSpacing: 1 }}>{subtitle}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** Small logo + name in the bottom-left corner (below the browser window). */
export const Watermark: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: 44,
      bottom: 20,
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontFamily: FONT,
      fontSize: 26,
      fontWeight: 700,
      color: '#fff',
      textShadow: '0 2px 12px rgba(0,0,0,.6)',
    }}
  >
    <Img src={staticFile('icon.png')} style={{ width: 42, height: 42, borderRadius: 10 }} />
    B站氛围光
  </div>
);

/** Browser window that scales in and slowly pushes in (Ken Burns) during the scene. */
export const AnimatedWindow: React.FC<{
  duration: number;
  width: number;
  top: number;
  url: string;
  title: string;
  children: React.ReactNode;
}> = ({ duration, width, top, url, title, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const push = interpolate(frame, [0, duration], [1, 1.035], { ...clamp, easing: Easing.inOut(Easing.quad) });
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{ marginTop: top, transform: `scale(${(0.94 + enter * 0.06) * push})`, opacity: enter }}>
        <BrowserFrame url={url} title={title} width={width}>
          {children}
        </BrowserFrame>
      </div>
    </AbsoluteFill>
  );
};

export const Pill: React.FC<{ children: React.ReactNode; accent?: boolean; size?: number }> = ({
  children,
  accent = false,
  size = 28,
}) => (
  <div
    style={{
      padding: `${size * 0.38}px ${size * 0.9}px`,
      borderRadius: size,
      fontFamily: FONT,
      fontSize: size,
      fontWeight: 600,
      color: '#fff',
      background: accent ? `linear-gradient(90deg, ${PINK}, ${BLUE})` : 'rgba(255,255,255,.1)',
      border: accent ? 'none' : '1px solid rgba(255,255,255,.18)',
      backdropFilter: 'blur(16px)',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </div>
);
