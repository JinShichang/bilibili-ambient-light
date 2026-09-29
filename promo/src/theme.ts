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
} as const;

export type ClipInfo = (typeof CLIPS)[keyof typeof CLIPS];
