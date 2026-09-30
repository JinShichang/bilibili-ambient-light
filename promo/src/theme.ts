export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const PINK = '#fb7299'; // Bilibili pink
export const BLUE = '#00aeec'; // Bilibili blue
export const FONT =
  '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

/** Recorded clips in public/clips (see scripts/record.mjs). */
export const CLIPS = {
  kdaOn: { src: 'clips/kda-on.mp4', url: 'bilibili.com/video/BV175411V75Q', title: '【4K画质 修复】英雄联盟 KDA女团 MORE CG动画' },
  kdaOff: { src: 'clips/kda-off.mp4', url: 'bilibili.com/video/BV175411V75Q', title: '【4K画质 修复】英雄联盟 KDA女团 MORE CG动画' },
  sky: { src: 'clips/sky-on.mp4', url: 'bilibili.com/video/BV16K4y1h7eq', title: '天空，云朵，落日，星空，流星「4k风光延时」' },
  cinema: { src: 'clips/cinema-on.mp4', url: 'bilibili.com/video/BV19D4y1S75R', title: '【4K60帧】英雄联盟《乘风归》动画短片 21:9' },
  landscape: { src: 'clips/landscape-on.mp4', url: 'bilibili.com/video/BV1t94y1C7fp', title: '现实中的动漫世界！4K HDR｜DJI Air 3' },
  jinx: { src: 'clips/jinx-on.mp4', url: 'bilibili.com/video/BV1kp4y1k7ax', title: '【4K重置】英雄联盟 暴走萝莉 金克丝 CG动画' },
  wuwa: { src: 'clips/wuwa-on.mp4', url: 'bilibili.com/video/BV1tbRhBKEWb', title: '《鸣潮》×《赛博朋克：边缘行者》联动预告' },
  wuwa2: { src: 'clips/wuwa2-on.mp4', url: 'bilibili.com/video/BV1gf421d7iS', title: '《鸣潮》公测PV | Waking of a World' },
  endfield: { src: 'clips/endfield-on.mp4', url: 'bilibili.com/video/BV1XTkNB3Er9', title: '《明日方舟：终末地》公测PV：Back to Endfield' },
  kurumi: { src: 'clips/kurumi-on.mp4', url: 'bilibili.com/video/BV17Et86SETm', title: 'FX战士久留美 正式PV【中文字幕】' },
  lnd: { src: 'clips/lnd-on.mp4', url: 'bilibili.com/video/BV1XR4y1E7cm', title: '【4K60FPS】英雄联盟《Legends Never Die》战歌起！传奇不朽！' },
  iceland: { src: 'clips/iceland-on.mp4', url: 'bilibili.com/video/BV1iT4y1F7at', title: '4K 冰岛之旅' },
} as const;

/** Frame counts of the recordings (scripts/record.mjs), used to fit clips to beat-snapped scenes. */
export const CLIP_FRAMES: Record<string, number> = {
  'clips/kda-on.mp4': 150,
  'clips/kda-off.mp4': 150,
  'clips/sky-on.mp4': 210,
  'clips/cinema-on.mp4': 210,
  'clips/landscape-on.mp4': 106,
  'clips/jinx-on.mp4': 195,
  'clips/wuwa-on.mp4': 90,
  'clips/wuwa2-on.mp4': 48,
  'clips/endfield-on.mp4': 72,
  'clips/kurumi-on.mp4': 105,
  'clips/lnd-on.mp4': 90,
  'clips/iceland-on.mp4': 150,
};

export const STORE_URL = 'chromewebstore.google.com';
export const REPO_URL = 'github.com/Miruko2/bilibili-ambient-light';

export type ClipInfo = (typeof CLIPS)[keyof typeof CLIPS];
