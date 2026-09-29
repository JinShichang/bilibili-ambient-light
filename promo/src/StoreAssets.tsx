import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { BLUE, FONT, PINK } from './theme';

/*
 * Still images for the Chrome Web Store listing. Sources are captured by scripts/store-shots.mjs
 * into public/store/. Render with: npm run store:stills
 */

const pill = (accent: boolean): React.CSSProperties => ({
  padding: '8px 20px',
  borderRadius: 22,
  fontFamily: FONT,
  fontSize: 20,
  fontWeight: 700,
  color: '#fff',
  whiteSpace: 'nowrap',
  background: accent ? `linear-gradient(90deg, ${PINK}, ${BLUE})` : 'rgba(20,20,26,.78)',
  border: accent ? 'none' : '1px solid rgba(255,255,255,.25)',
  boxShadow: '0 6px 20px rgba(0,0,0,.45)',
});

/** 1280x800: the same frame with the light on (left) and off (right). */
export const StoreCompare: React.FC<{ split: number; labelTop: number }> = ({ split, labelTop }) => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    <Img src={staticFile('store/kda-off.png')} style={{ position: 'absolute', inset: 0 }} />
    <Img
      src={staticFile('store/kda-on.png')}
      style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${1280 - split}px 0 0)` }}
    />
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: split - 2,
        width: 4,
        background: `linear-gradient(${PINK}, ${BLUE})`,
        boxShadow: `0 0 22px 5px ${PINK}99`,
      }}
    />
    <div style={{ position: 'absolute', top: labelTop, right: 1280 - split + 18, ...pill(true) }}>开启氛围光</div>
    <div style={{ position: 'absolute', top: labelTop, left: split + 18, ...pill(false) }}>关闭</div>
  </AbsoluteFill>
);

/** 440x280 small promo tile. */
export const StoreTile: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#07070c', overflow: 'hidden' }}>
    <Img
      src={staticFile('store/kda-on.png')}
      style={{
        position: 'absolute',
        left: -60,
        top: -40,
        width: 560,
        height: 350,
        objectFit: 'cover',
        filter: 'blur(18px) saturate(1.5) brightness(0.75)',
      }}
    />
    <AbsoluteFill
      style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,.15) 0%, rgba(0,0,0,.6) 100%)' }}
    />
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#fff' }}>
      <Img
        src={staticFile('icon.png')}
        style={{ width: 84, height: 84, filter: `drop-shadow(0 0 18px ${PINK}) drop-shadow(0 0 26px ${BLUE}aa)` }}
      />
      <div
        style={{
          marginTop: 14,
          fontSize: 50,
          fontWeight: 800,
          letterSpacing: 5,
          textShadow: `0 2px 16px rgba(0,0,0,.6), 0 0 30px ${PINK}88`,
        }}
      >
        B站氛围光
      </div>
      <div style={{ marginTop: 4, fontSize: 17, letterSpacing: 3, color: 'rgba(255,255,255,.85)' }}>
        AMBIENT LIGHT FOR BILIBILI
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
);
