import React from 'react';
import { AbsoluteFill, Audio, Sequence, getStaticFiles, interpolate, staticFile } from 'remotion';
import beats from './beats.json';
import { FadeIn } from './components';
import { Compare, Feature, Montage, MontagePart, Outro, Settings } from './scenes';
import { StoreScene } from './StoreScene';
import { CLIPS, FPS } from './theme';

/*
 * Scene lengths are counted in beats of the soundtrack (src/beats.json, from scripts/music.mjs),
 * so every cut lands on the music. The beat grid starts at the first detected beat.
 */
const BEAT_SECONDS = 60 / beats.bpm;
const BEAT_FRAMES = BEAT_SECONDS * FPS;
const beatFrame = (n: number) => Math.round((beats.firstBeat + n * BEAT_SECONDS) * FPS);

const FADE = 12; // Default crossfade (frames); the transition midpoint sits on the beat.
const END_FADE = 36;

type SceneDef = {
  id: string;
  beats: number;
  fade?: number;
  render: (duration: number, startBeat: number, from: number) => React.ReactNode;
};

/** Montage parts in beats, converted to frames relative to the montage's start. */
const MONTAGE_PARTS: Array<{ clip: MontagePart['clip']; label: string; beats: number }> = [
  { clip: CLIPS.lnd, label: '英雄联盟《Legends Never Die》', beats: 3 },
  { clip: CLIPS.wuwa, label: '鸣潮 × 赛博朋克：边缘行者', beats: 4 },
  { clip: CLIPS.wuwa2, label: '鸣潮', beats: 2 },
  { clip: CLIPS.endfield, label: '明日方舟：终末地', beats: 3 },
  { clip: CLIPS.kurumi, label: 'FX战士久留美', beats: 4 },
];

/*
 * Opens directly on the before/after comparison: the effect itself is the hook. The soundtrack
 * dips at beat 41 (settings) and turns calm at beats 62-64 (outro).
 */
const SCENES: SceneDef[] = [
  { id: 'compare', beats: 6, render: (d) => <Compare duration={d} /> },
  {
    id: 'montage',
    beats: MONTAGE_PARTS.reduce((sum, p) => sum + p.beats, 0),
    fade: 2, // hard cut + flash
    render: (d, startBeat, from) => {
      let beat = startBeat;
      const parts = MONTAGE_PARTS.map((p, i) => {
        const partFrom = i === 0 ? 0 : beatFrame(beat) - from;
        beat += p.beats;
        const partEnd = i === MONTAGE_PARTS.length - 1 ? d : beatFrame(beat) - from;
        return { clip: p.clip, label: p.label, from: partFrom, duration: partEnd - partFrom };
      });
      return <Montage duration={d} parts={parts} title="游戏 CG、二游 PV、当季新番，一样沉浸" subtitle="画面越炫，氛围光越出彩" />;
    },
  },
  {
    id: 'sky',
    beats: 5,
    render: (d) => (
      <Feature clip={CLIPS.sky} duration={d} title="实时跟随画面变化" subtitle="逐帧取色，柔和扩散，自然渐隐到页面边缘" />
    ),
  },
  {
    id: 'cinema',
    beats: 5,
    render: (d) => (
      <Feature
        clip={CLIPS.cinema}
        duration={d}
        title="自动适配画幅与黑边"
        subtitle="宽银幕电影、带黑边的老视频，光都从画面真正的边缘出发"
      />
    ),
  },
  {
    id: 'iceland',
    beats: 5,
    render: (d) => (
      <Feature
        clip={CLIPS.iceland}
        duration={d}
        title="通透页面，内容依旧清晰"
        subtitle="页面切换为半透明深色主题并加上文字阴影，光再亮也看得清"
      />
    ),
  },
  {
    id: 'landscape',
    beats: 4, // the recording is one 106-frame drone shot
    render: (d) => (
      <Feature clip={CLIPS.landscape} duration={d} title="宽屏模式同样生效" subtitle="播放器变大，光晕也随之铺满整个页面" />
    ),
  },
  { id: 'settings', beats: 7, render: () => <Settings /> },
  // The real store pages: search, open the listing, 添加至 Chrome, privacy section.
  { id: 'store', beats: 14, render: () => <StoreScene beat={BEAT_FRAMES} lead={Math.floor(FADE / 2)} /> },
  { id: 'outro', beats: 10, render: () => <Outro beat={Math.round(BEAT_FRAMES)} /> },
];

type TimelineEntry = SceneDef & { from: number; duration: number; startBeat: number };

// Scene i covers [boundary(i-1) - fade/2, boundary(i) + nextFade/2]: crossfades are centered on beats.
const TIMELINE: TimelineEntry[] = (() => {
  const bounds: number[] = [];
  const starts: number[] = [];
  let cum = 0;
  for (const scene of SCENES) {
    starts.push(cum);
    cum += scene.beats;
    bounds.push(beatFrame(cum));
  }
  return SCENES.map((scene, i) => {
    const fadeIn = i === 0 ? 0 : scene.fade ?? FADE;
    const from = i === 0 ? 0 : bounds[i - 1] - Math.floor(fadeIn / 2);
    const next = SCENES[i + 1];
    const end = next ? bounds[i] + Math.ceil((next.fade ?? FADE) / 2) : bounds[i];
    return { ...scene, fade: fadeIn, from, duration: end - from, startBeat: starts[i] };
  });
})();

const LAST = TIMELINE[TIMELINE.length - 1];
export const PROMO_DURATION = LAST.from + LAST.duration;

/** Soundtrack prepared by scripts/music.mjs (already starts at the chosen offset in the song). */
const hasMusic = getStaticFiles().some((file) => file.name === 'music.wav');

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    {TIMELINE.map((scene, i) => (
      <Sequence key={scene.id} name={scene.id} from={scene.from} durationInFrames={scene.duration}>
        <FadeIn duration={scene.duration} fade={scene.fade ?? FADE} fadeOut={i === TIMELINE.length - 1 ? END_FADE : 0}>
          {scene.render(scene.duration, scene.startBeat, scene.from)}
        </FadeIn>
      </Sequence>
    ))}
    {hasMusic ? (
      <Audio
        src={staticFile('music.wav')}
        volume={(f) =>
          interpolate(f, [0, 8, PROMO_DURATION - 54, PROMO_DURATION], [0, 0.85, 0.85, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    ) : null}
  </AbsoluteFill>
);
