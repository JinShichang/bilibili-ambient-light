import React from 'react';
import { AbsoluteFill, Audio, Sequence, getStaticFiles, interpolate, staticFile } from 'remotion';
import { FadeIn } from './components';
import { Compare, Feature, Intro, Outro, Settings } from './scenes';
import { CLIPS } from './theme';

const FADE = 12; // Crossfade length between scenes (frames)

type SceneDef = { id: string; duration: number; render: (duration: number) => React.ReactNode };

const SCENES: SceneDef[] = [
  { id: 'intro', duration: 100, render: () => <Intro /> },
  { id: 'compare', duration: 150, render: (d) => <Compare duration={d} /> },
  {
    id: 'sky',
    duration: 140,
    render: (d) => (
      <Feature clip={CLIPS.sky} duration={d} title="实时跟随画面变化" subtitle="逐帧取色，柔和扩散，自然渐隐到页面边缘" />
    ),
  },
  {
    id: 'cinema',
    duration: 140,
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
    id: 'landscape',
    duration: 140,
    render: (d) => (
      <Feature
        clip={CLIPS.landscape}
        duration={d}
        title="宽屏模式同样生效"
        subtitle="播放器变大，光晕也随之铺满整个页面"
      />
    ),
  },
  { id: 'settings', duration: 165, render: () => <Settings /> },
  { id: 'outro', duration: 120, render: () => <Outro /> },
];

// Each scene starts FADE frames before the previous one ends and fades in on top of it.
const TIMELINE = SCENES.reduce<Array<SceneDef & { from: number }>>((list, scene, i) => {
  const prev = list[i - 1];
  list.push({ ...scene, from: prev ? prev.from + prev.duration - FADE : 0 });
  return list;
}, []);

export const PROMO_DURATION = TIMELINE[TIMELINE.length - 1].from + TIMELINE[TIMELINE.length - 1].duration;

/** Optional soundtrack: drop a music.mp3 into promo/public/ and it is mixed in with fades. */
const music = getStaticFiles().find((file) => file.name === 'music.mp3');

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    {TIMELINE.map((scene, i) => (
      <Sequence key={scene.id} name={scene.id} from={scene.from} durationInFrames={scene.duration}>
        <FadeIn duration={scene.duration} fade={FADE} fadeOut={i === TIMELINE.length - 1}>
          {scene.render(scene.duration)}
        </FadeIn>
      </Sequence>
    ))}
    {music ? (
      <Audio
        src={staticFile('music.mp3')}
        volume={(f) => interpolate(f, [0, 30, PROMO_DURATION - 45, PROMO_DURATION], [0, 0.8, 0.8, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })}
      />
    ) : null}
  </AbsoluteFill>
);
