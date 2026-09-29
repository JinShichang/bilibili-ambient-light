import React from 'react';
import { Composition, Still } from 'remotion';
import { PROMO_DURATION, Promo } from './Promo';
import { StoreCompare, StoreTile } from './StoreAssets';
import { FPS, HEIGHT, WIDTH } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={PROMO_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Still
      id="StoreCompare"
      component={StoreCompare}
      width={1280}
      height={800}
      defaultProps={{ split: 472, labelTop: 160 }}
    />
    <Still id="StoreTile" component={StoreTile} width={440} height={280} />
  </>
);
